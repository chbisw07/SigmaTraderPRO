from __future__ import annotations

from datetime import UTC, datetime, timedelta

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
import app.models.system_event  # noqa: F401
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


def _create_user(db: Session, *, email: str, password: str) -> None:
    user = User(email=email, password_hash=hash_password(password), is_active=True)
    db.add(user)
    db.commit()


def _login(client: TestClient, email: str, password: str) -> str:
    resp = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _ensure_equity_instrument(
    db: Session, canonical_id: str = "NSE_EQ:EQUITY:EQUITY:INFY"
) -> Instrument:
    inst = Instrument(
        canonical_id=canonical_id,
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
        isin="INE009A01021",
        is_active=True,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


def _connect_angel(db: Session, *, user_id: int, api_key: str = "A") -> None:
    conn = BrokerConnection(
        user_id=user_id,
        broker_key="angel",
        is_enabled=True,
        credentials_enc=encrypt_json(
            {"api_key": api_key, "client_code": "C", "password": "P"},
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


def _connect_zerodha(db: Session, *, user_id: int, api_key: str = "Z") -> None:
    conn = BrokerConnection(
        user_id=user_id,
        broker_key="zerodha",
        is_enabled=True,
        credentials_enc=encrypt_json(
            {"api_key": api_key, "api_secret": "S"},
            key=settings.broker_encryption_key,
        ),
        session_enc=encrypt_json(
            {"access_token": "AT", "public_token": "PT", "user_id": "U"},
            key=settings.broker_encryption_key,
        ),
        session_day=today_ist(),
        last_connected_at=datetime.now(tz=UTC),
        last_error=None,
    )
    db.add(conn)
    db.commit()


def test_stock_order_preview_validates_and_returns_routing(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u@example.com").one()
    _connect_angel(db_session, user_id=user.id)

    inst = _ensure_equity_instrument(db_session)
    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="1594",
            broker_trading_symbol="INFY-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    access = _login(client, "u@example.com", "pass123")

    resp = client.post(
        "/api/v1/orders/preview",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["instrument"]["canonical_id"] == inst.canonical_id
    assert data["routing"]["broker"] == "angel"
    assert data["routing"]["exchange"] == "NSE"
    assert data["routing"]["trading_symbol"] == "INFY-EQ"


def test_stock_order_create_places_order_with_mocked_broker(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u2@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u2@example.com").one()
    _connect_angel(db_session, user_id=user.id)

    inst = _ensure_equity_instrument(
        db_session, canonical_id="NSE_EQ:EQUITY:EQUITY:TCS"
    )
    inst.symbol_root = "TCS"
    inst.display_symbol = "TCS"
    db_session.commit()

    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="11536",
            broker_trading_symbol="TCS-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.brokers.angel_adapter.place_order",
        lambda **_: "ANGEL_ORDER_ID_1",
    )

    access = _login(client, "u2@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 2,
            "product": "MIS",
            "order_type": "LIMIT",
            "limit_price": 1234.5,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ACKNOWLEDGED"
    assert data["broker_order_id"] == "ANGEL_ORDER_ID_1"
    assert data["correlation_id"]

    updated_user = db_session.query(User).filter(User.id == user.id).one()
    assert updated_user.last_used_broker == "angel"

    created = db_session.query(Order).filter(Order.id == data["order_id"]).one()
    assert created.correlation_id == data["correlation_id"]
    assert created.blocked_reason_code is None
    assert created.failure_reason_code is None


def test_stock_order_create_blocks_when_broker_session_missing(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u_block@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u_block@example.com").one()

    # Configured + enabled, but missing session (needs reconnect).
    conn = BrokerConnection(
        user_id=user.id,
        broker_key="angel",
        is_enabled=True,
        credentials_enc=encrypt_json(
            {"api_key": "A", "client_code": "C", "password": "P"},
            key=settings.broker_encryption_key,
        ),
        session_enc=None,
        session_day=None,
        last_connected_at=None,
        last_error=None,
    )
    db_session.add(conn)
    db_session.commit()

    inst = _ensure_equity_instrument(
        db_session, canonical_id="NSE_EQ:EQUITY:EQUITY:SBIN"
    )
    inst.symbol_root = "SBIN"
    inst.display_symbol = "SBIN"
    db_session.commit()
    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="3045",
            broker_trading_symbol="SBIN-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    # Ensure we never attempt dispatch when blocked.
    def _no_dispatch(**_):  # type: ignore[no-untyped-def]
        raise AssertionError("dispatch should not be attempted")

    monkeypatch.setattr("app.brokers.angel_adapter.place_order", _no_dispatch)

    access = _login(client, "u_block@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "BLOCKED"
    assert data["broker_order_id"] is None
    assert data["blocked_reason_code"] == "BROKER_SESSION_MISSING"
    assert "blocked" in (data["blocked_reason_message"] or "").lower()
    assert data["correlation_id"]

    created = db_session.query(Order).filter(Order.id == data["order_id"]).one()
    assert created.status == "BLOCKED"
    assert created.blocked_reason_code == "BROKER_SESSION_MISSING"
    assert created.correlation_id == data["correlation_id"]


def test_stock_order_create_blocks_when_broker_session_stale(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u_stale@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u_stale@example.com").one()
    _connect_angel(db_session, user_id=user.id)

    # Force stale session model: session_day != today.
    conn = (
        db_session.query(BrokerConnection)
        .filter(BrokerConnection.user_id == user.id)
        .filter(BrokerConnection.broker_key == "angel")
        .one()
    )
    conn.session_day = today_ist() - timedelta(days=1)
    db_session.commit()

    inst = _ensure_equity_instrument(
        db_session, canonical_id="NSE_EQ:EQUITY:EQUITY:ITC"
    )
    inst.symbol_root = "ITC"
    inst.display_symbol = "ITC"
    db_session.commit()
    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="1660",
            broker_trading_symbol="ITC-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    def _no_dispatch(**_):  # type: ignore[no-untyped-def]
        raise AssertionError("dispatch should not be attempted")

    monkeypatch.setattr("app.brokers.angel_adapter.place_order", _no_dispatch)

    access = _login(client, "u_stale@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "BLOCKED"
    assert data["blocked_reason_code"] == "BROKER_SESSION_STALE"


def test_stock_order_create_persists_dispatch_failure(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u_fail@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u_fail@example.com").one()
    _connect_angel(db_session, user_id=user.id)

    inst = _ensure_equity_instrument(
        db_session, canonical_id="NSE_EQ:EQUITY:EQUITY:HDFCBANK"
    )
    inst.symbol_root = "HDFCBANK"
    inst.display_symbol = "HDFCBANK"
    db_session.commit()
    db_session.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="1333",
            broker_trading_symbol="HDFCBANK-EQ",
            raw={},
            is_active=True,
        )
    )
    db_session.commit()

    calls: list[str] = []

    def _boom(**_):
        calls.append("called")
        raise RuntimeError("network down")

    monkeypatch.setattr("app.brokers.angel_adapter.place_order", _boom)

    access = _login(client, "u_fail@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "MIS",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "DISPATCH_FAILED"
    assert data["failure_reason_code"] == "BROKER_DISPATCH_ERROR"
    assert data["correlation_id"]
    assert calls == ["called"]

    created = db_session.query(Order).filter(Order.id == data["order_id"]).one()
    assert created.status == "DISPATCH_FAILED"
    assert created.failure_reason_code == "BROKER_DISPATCH_ERROR"


def test_limit_requires_price(db_session: Session, client: TestClient) -> None:
    _create_user(db_session, email="u3@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u3@example.com").one()
    _connect_zerodha(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)

    access = _login(client, "u3@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/preview",
        json={
            "broker": "zerodha",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "LIMIT",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 400
    assert "limit_price" in resp.json()["detail"]


def test_zerodha_market_is_blocked_until_market_protection_supported(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u5@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u5@example.com").one()
    _connect_zerodha(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)

    access = _login(client, "u5@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/preview",
        json={
            "broker": "zerodha",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 400
    assert "market protection" in resp.json()["detail"].lower()


def test_create_returns_400_on_broker_reject(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="u4@example.com", password="pass123")
    user = db_session.query(User).filter(User.email == "u4@example.com").one()
    _connect_zerodha(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)

    monkeypatch.setattr(
        "app.brokers.zerodha_adapter.place_order",
        lambda **_: (_ for _ in ()).throw(Exception("Market is closed")),
    )

    access = _login(client, "u4@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "zerodha",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )

    # May be 400 (broker reject) or 502 depending on adapter wrapper;
    # ensure we never produce a silent 500 for broker-side failure.
    assert resp.status_code in {400, 502}
