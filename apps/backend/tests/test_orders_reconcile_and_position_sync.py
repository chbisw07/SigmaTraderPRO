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
import app.models.position  # noqa: F401
import app.models.user  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.order import Order
from app.models.position import Position
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
    settings.broker_encryption_key = "test-broker-key"
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


def test_orders_reconcile_updates_internal_status_and_avg_price(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u@example.com", password="pass123")
    db_session.add(
        Order(
            user_id=user.id,
            broker_key="angel",
            canonical_id="NSE_EQ:EQUITY:EQUITY:TCS",
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
            preview_snapshot_json=None,
            broker_payload_json=None,
            broker_symbol_resolved=None,
            broker_symbol_token_resolved=None,
            lot_size_snapshot=1,
            margin_snapshot_json=None,
            status="PENDING",
            broker_order_id="BO1",
            error_message=None,
        )
    )
    db_session.commit()

    class _FakeAdapter:
        def __init__(self, broker: str):
            self._broker = broker

        def fetch_recent_orders(self, db, user):
            _ = (db, user)
            if self._broker != "angel":
                return []
            return [
                ExternalBrokerOrder(
                    broker="angel",
                    broker_order_id="BO1",
                    exchange_order_id="EXCH1",
                    exchange="NSE",
                    trading_symbol="TCS-EQ",
                    broker_instrument_id=None,
                    placed_at=datetime.now(tz=UTC),
                    side="BUY",
                    product="DELIVERY",
                    order_type="LIMIT",
                    quantity=1,
                    price=10.0,
                    avg_price=12.34,
                    status="COMPLETE",
                    rejection_reason=None,
                )
            ]

    monkeypatch.setattr(
        "app.services.orders_workspace_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(broker.value),
    )

    access = _login(client, "u@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/reconcile",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200

    o = db_session.query(Order).filter(Order.user_id == user.id).one()
    assert o.status == "EXECUTED"
    assert float(o.avg_executed_price) == 12.34
    assert isinstance(o.preview_snapshot_json, dict)
    assert o.preview_snapshot_json["exchange_order_id"] == "EXCH1"


def test_positions_refresh_sync_updates_quantity_and_closes_missing(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u2@example.com", password="pass123")
    inst = Instrument(
        canonical_id="NSE_EQ:EQUITY:EQUITY:INFY",
        exchange="NSE_EQ",
        segment="EQUITY",
        instrument_type="EQUITY",
        symbol_root="INFY",
        display_symbol="INFY",
        underlying=None,
        expiry=None,
        strike=None,
        option_type=None,
        lot_size=1,
        tick_size=0.05,
        isin=None,
        is_active=True,
    )
    db_session.add(inst)
    db_session.commit()
    db_session.refresh(inst)

    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="123",
            broker_trading_symbol="INFY-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    pos = Position(
        user_id=user.id,
        broker_key="angel",
        canonical_id=inst.canonical_id,
        side="BUY",
        quantity=1,
        lots=None,
        avg_price=10.0,
        last_price=None,
        realized_pnl=None,
        unrealized_pnl=None,
        mtm=None,
        broker_position_id=None,
        source="manual_ui",
    )
    db_session.add(pos)
    db_session.commit()
    db_session.refresh(pos)

    class _FakeAdapter:
        def fetch_positions(self, db, user):
            _ = (db, user)
            return [
                ExternalBrokerPosition(
                    broker="angel",
                    broker_position_id="P1",
                    exchange="NSE",
                    trading_symbol="INFY-EQ",
                    broker_instrument_id="123",
                    net_quantity=5,
                    avg_price=99.0,
                    last_price=100.0,
                    realized_pnl=None,
                    unrealized_pnl=5.0,
                    mtm=5.0,
                )
            ]

        def fetch_recent_orders(self, db, user):
            _ = (db, user)
            return []

    monkeypatch.setattr(
        "app.services.position_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    access = _login(client, "u2@example.com", "pass123")
    resp = client.post(
        f"/api/v1/positions/{pos.id}/refresh",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200

    resp2 = client.get(
        "/api/v1/positions",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 200
    items = resp2.json()["items"]
    assert len(items) == 1
    assert items[0]["quantity"] == 5
    assert items[0]["avg_price"] == 99.0
    assert items[0]["last_price"] == 100.0

    class _EmptyAdapter:
        def fetch_positions(self, db, user):
            _ = (db, user)
            return []

        def fetch_recent_orders(self, db, user):
            _ = (db, user)
            return []

    monkeypatch.setattr(
        "app.services.position_service.broker_service.get_adapter",
        lambda broker: _EmptyAdapter(),
    )
    _ = client.post(
        f"/api/v1/positions/{pos.id}/refresh",
        headers={"Authorization": f"Bearer {access}"},
    )
    resp3 = client.get(
        "/api/v1/positions",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp3.status_code == 200
    assert resp3.json()["items"] == []
