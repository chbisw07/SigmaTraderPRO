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
from app.core.crypto import encrypt_json
from app.core.security import hash_password
from app.core.time import today_ist
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.broker_connection import BrokerConnection
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.order import Order
from app.models.user import User
from app.orders.types import ExternalBrokerOrder


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


def _connect_angel(db: Session, *, user_id: int) -> None:
    conn = BrokerConnection(
        user_id=user_id,
        broker_key="angel",
        is_enabled=True,
        credentials_enc=encrypt_json(
            {"api_key": "A", "client_code": "C", "password": "P"},
            key=settings.broker_encryption_key,
        ),
        session_enc=encrypt_json(
            {"jwt_token": "JWT", "refresh_token": "R", "feed_token": "F"},
            key=settings.broker_encryption_key,
        ),
        session_day=today_ist(),
        last_connected_at=datetime.now(tz=UTC),
        last_error=None,
    )
    db.add(conn)
    db.commit()


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


def _map_instrument(db: Session, inst: Instrument) -> None:
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="123",
            broker_trading_symbol=f"{inst.symbol_root}-EQ",
            raw={},
            is_active=True,
        )
    )
    db.commit()


def test_include_broker_orders_preference_default_true_and_persists(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u@example.com", password="pass123")
    access = _login(client, "u@example.com", "pass123")

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["include_broker_orders"] is True

    upd = client.patch(
        "/api/v1/auth/me/preferences",
        json={"include_broker_orders": False},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert upd.status_code == 200
    assert upd.json()["include_broker_orders"] is False

    me2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me2.status_code == 200
    assert me2.json()["include_broker_orders"] is False


def test_orders_workspace_merged_includes_broker_rows_and_matches(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u2@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument(db_session, inst)

    # Create one internal order that should match broker_order_id.
    o = Order(
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
        status="PENDING",
        broker_order_id="BROKER_ORDER_1",
        error_message=None,
    )
    db_session.add(o)
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
                ),
                ExternalBrokerOrder(
                    broker="angel",
                    broker_order_id="BROKER_ORDER_2",
                    exchange_order_id="EXCH_2",
                    exchange="NSE",
                    trading_symbol="TCS-EQ",
                    broker_instrument_id="999",
                    placed_at=datetime.now(tz=UTC),
                    side="BUY",
                    product="DELIVERY",
                    order_type="LIMIT",
                    quantity=1,
                    price=1.0,
                    avg_price=None,
                    status="OPEN",
                    rejection_reason=None,
                ),
            ]

    monkeypatch.setattr(
        "app.services.orders_workspace_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    access = _login(client, "u2@example.com", "pass123")
    resp = client.get(
        "/api/v1/orders/workspace?mode=merged&limit=50",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["include_broker_orders"] is True
    # One merged + one broker-only.
    origins = {row["source_origin"] for row in data["items"]}
    assert "merged" in origins
    assert "broker_external" in origins


def test_orders_workspace_gracefully_degrades_on_broker_failure(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u3@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")

    db_session.add(
        Order(
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
            preview_snapshot_json=None,
            broker_payload_json=None,
            broker_symbol_resolved=None,
            broker_symbol_token_resolved=None,
            lot_size_snapshot=1,
            margin_snapshot_json=None,
            status="PENDING",
            broker_order_id="BROKER_ORDER_1",
            error_message=None,
        )
    )
    db_session.commit()

    class _FailAdapter:
        def fetch_recent_orders(self, db, user):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        "app.services.orders_workspace_service.broker_service.get_adapter",
        lambda broker: _FailAdapter(),
    )

    access = _login(client, "u3@example.com", "pass123")
    resp = client.get(
        "/api/v1/orders/workspace?mode=merged&limit=50",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["source_origin"] == "sigmatrader"
    assert data["meta"]["broker_errors"]


def test_orders_workspace_mode_forced_to_internal_when_preference_disabled(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="u4@example.com", password="pass123")
    user.include_broker_orders = False
    db_session.commit()

    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    db_session.add(
        Order(
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
            preview_snapshot_json=None,
            broker_payload_json=None,
            broker_symbol_resolved=None,
            broker_symbol_token_resolved=None,
            lot_size_snapshot=1,
            margin_snapshot_json=None,
            status="PENDING",
            broker_order_id="BROKER_ORDER_1",
            error_message=None,
        )
    )
    db_session.commit()

    access = _login(client, "u4@example.com", "pass123")
    resp = client.get(
        "/api/v1/orders/workspace?mode=broker_only&limit=50",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["include_broker_orders"] is False
    assert data["meta"]["mode"] == "internal_only"


def test_orders_workspace_search_and_product_filter(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="u_search@example.com", password="pass123")
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")

    o1 = Order(
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
        preview_snapshot_json=None,
        broker_payload_json=None,
        broker_symbol_resolved=None,
        broker_symbol_token_resolved=None,
        lot_size_snapshot=1,
        margin_snapshot_json=None,
        status="BLOCKED",
        broker_order_id="BROKER_ORDER_123",
        error_message=None,
        correlation_id="CORR_TEST_123",
        blocked_reason_code="BROKER_SESSION_STALE",
        blocked_reason_message="broker session is stale",
        failure_reason_code=None,
        failure_reason_message=None,
        dispatch_tags_json=None,
        dispatch_diagnostics_json=None,
    )
    o2 = Order(
        user_id=user.id,
        broker_key="angel",
        canonical_id=inst.canonical_id,
        side="SELL",
        quantity=2,
        lots=None,
        product="MIS",
        order_type="MARKET",
        limit_price=None,
        avg_executed_price=None,
        source="manual_ui",
        intent_type="ENTRY",
        trigger_mode="MARKET",
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
        broker_order_id="BROKER_ORDER_999",
        error_message=None,
        correlation_id="CORR_TEST_999",
        blocked_reason_code=None,
        blocked_reason_message=None,
        failure_reason_code=None,
        failure_reason_message=None,
        dispatch_tags_json=None,
        dispatch_diagnostics_json=None,
    )
    db_session.add_all([o1, o2])
    db_session.commit()

    access = _login(client, "u_search@example.com", "pass123")

    # Search by correlation id.
    resp = client.get(
        "/api/v1/orders/workspace?mode=internal_only&q=CORR_TEST_123",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["internal_order_id"] == o1.id
    assert items[0]["correlation_id"] == "CORR_TEST_123"

    # Search by broker order id.
    resp2 = client.get(
        "/api/v1/orders/workspace?mode=internal_only&q=BROKER_ORDER_999",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 200
    items2 = resp2.json()["items"]
    assert len(items2) == 1
    assert items2[0]["internal_order_id"] == o2.id

    # Search by blocked reason text.
    resp3 = client.get(
        "/api/v1/orders/workspace?mode=internal_only&q=stale",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp3.status_code == 200
    assert len(resp3.json()["items"]) == 1

    # Filter by product.
    resp4 = client.get(
        "/api/v1/orders/workspace?mode=internal_only&product=CNC",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp4.status_code == 200
    items4 = resp4.json()["items"]
    assert len(items4) == 1
    assert items4[0]["internal_order_id"] == o1.id


def test_orders_workspace_marks_unresolved_when_broker_truth_differs(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(
        db_session, email="u_unresolved@example.com", password="pass123"
    )
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument(db_session, inst)

    db_session.add(
        Order(
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
        )
    )
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

    access = _login(client, "u_unresolved@example.com", "pass123")
    resp = client.get(
        "/api/v1/orders/workspace?mode=merged&limit=50",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    merged = [r for r in resp.json()["items"] if r["source_origin"] == "merged"]
    assert merged
    assert merged[0]["reconciliation_state"] == "unresolved"
