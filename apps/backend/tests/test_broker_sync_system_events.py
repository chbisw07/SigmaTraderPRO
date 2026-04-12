from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.broker_connection  # noqa: F401
import app.models.instrument  # noqa: F401
import app.models.instrument_mapping  # noqa: F401
import app.models.order  # noqa: F401
import app.models.system_event  # noqa: F401
import app.models.user  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.order import Order
from app.models.system_event import SystemEvent
from app.models.user import User
from app.orders.types import ExternalBrokerOrder, ExternalBrokerPosition


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture()
def client(db_session: Session, tmp_path):
    settings.jwt_secret_key = "test-secret-test-secret-test-secret-32bytes"
    settings.jwt_algorithm = "HS256"
    settings.log_dir = tmp_path / "logs"
    settings.audit_csv_dir = tmp_path / "audit"

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _create_user(db: Session, *, email: str, password: str) -> User:
    user = User(email=email, password_hash=hash_password(password), is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, email: str, password: str) -> str:
    resp = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _ensure_equity_instrument(db: Session, canonical_id: str) -> Instrument:
    inst = Instrument(
        canonical_id=canonical_id,
        exchange="NSE_EQ",
        segment="EQUITY",
        instrument_type="EQUITY",
        symbol_root=canonical_id.split(":")[-1],
        display_symbol=canonical_id.split(":")[-1],
        underlying=None,
        expiry=None,
        strike=None,
        option_type=None,
        lot_size=1,
        tick_size=0.05,
        isin=None,
        is_active=True,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


def _map_instrument(
    db: Session,
    inst: Instrument,
    *,
    broker_key: str,
    broker_id: str,
    trading: str,
) -> None:
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key=broker_key,
            broker_instrument_id=broker_id,
            broker_trading_symbol=trading,
            raw={},
            is_active=True,
        )
    )
    db.commit()


def test_orders_reconcile_emits_system_events_and_updates_status(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u@example.com", password="pass123")
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument(
        db_session, inst, broker_key="angel", broker_id="123", trading="INFY-EQ"
    )

    order = Order(
        user_id=user.id,
        broker_key="angel",
        canonical_id=inst.canonical_id,
        side="BUY",
        quantity=1,
        lots=None,
        product="CNC",
        order_type="LIMIT",
        limit_price=10.0,
        avg_executed_price=None,
        source="manual_ui",
        intent_type="ENTRY",
        trigger_mode="LIMIT",
        risk_mode=None,
        sl_value=None,
        tp_value=None,
        trailing_value=None,
        parent_order_id=None,
        linked_position_id=None,
        broker_context="angel",
        preview_snapshot_json={"canonical_id": inst.canonical_id},
        broker_payload_json=None,
        broker_symbol_resolved="INFY-EQ",
        broker_symbol_token_resolved="123",
        lot_size_snapshot=1,
        margin_snapshot_json=None,
        status="ACKNOWLEDGED",
        broker_order_id="BROKER_ORDER_1",
        error_message=None,
        correlation_id="CORR_ORDER_1",
    )
    db_session.add(order)
    db_session.commit()

    class _FakeAdapter:
        def fetch_recent_orders(self, db, user):
            _ = (db, user)
            return [
                ExternalBrokerOrder(
                    broker="angel",
                    broker_order_id="BROKER_ORDER_1",
                    exchange_order_id="EXCH_1",
                    exchange="NSE",
                    trading_symbol="INFY-EQ",
                    broker_instrument_id="123",
                    placed_at=datetime.now(tz=UTC),
                    side="BUY",
                    product="DELIVERY",
                    order_type="LIMIT",
                    quantity=1,
                    price=10.0,
                    avg_price=10.0,
                    status="COMPLETE",
                    rejection_reason=None,
                )
            ]

    monkeypatch.setattr(
        "app.services.orders_workspace_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    access = _login(client, "u@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/reconcile", headers={"Authorization": f"Bearer {access}"}
    )
    assert resp.status_code == 200

    updated = db_session.query(Order).filter(Order.id == order.id).one()
    assert updated.status == "EXECUTED"

    events = (
        db_session.query(SystemEvent)
        .filter(SystemEvent.category == "broker_sync")
        .all()
    )
    assert events
    # Transition event should use the order correlation id.
    assert any(e.correlation_id == "CORR_ORDER_1" for e in events)
    assert any("Orders reconciled" in e.message for e in events)


def test_positions_sync_emits_system_event(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _ = _create_user(db_session, email="p@example.com", password="pass123")
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:TCS")
    _map_instrument(
        db_session, inst, broker_key="angel", broker_id="999", trading="TCS-EQ"
    )

    class _FakeAdapter:
        def fetch_positions(self, db, user):
            _ = (db, user)
            return [
                ExternalBrokerPosition(
                    broker="angel",
                    broker_position_id="POS_1",
                    exchange="NSE",
                    trading_symbol="TCS-EQ",
                    broker_instrument_id="999",
                    net_quantity=1,
                    avg_price=100.0,
                    last_price=101.0,
                    realized_pnl=None,
                    unrealized_pnl=1.0,
                    mtm=1.0,
                )
            ]

    monkeypatch.setattr(
        "app.services.position_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    access = _login(client, "p@example.com", "pass123")
    resp = client.post(
        "/api/v1/positions/sync?broker=angel",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200

    events = (
        db_session.query(SystemEvent)
        .filter(SystemEvent.category == "broker_sync")
        .all()
    )
    assert any("Positions synced" in e.message for e in events)
