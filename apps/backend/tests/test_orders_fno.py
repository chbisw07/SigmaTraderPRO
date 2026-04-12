from __future__ import annotations

from datetime import UTC, date, datetime

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


def _connect_broker(db: Session, *, user_id: int, broker_key: str) -> None:
    if broker_key == "angel":
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
    else:
        conn = BrokerConnection(
            user_id=user_id,
            broker_key="zerodha",
            is_enabled=True,
            credentials_enc=encrypt_json(
                {"api_key": "Z", "api_secret": "S"},
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


def _create_option(
    db: Session,
    *,
    underlying: str = "NIFTY",
    expiry: date = date(2026, 5, 5),
    strike: float = 2010000,
    option_type: str = "CE",
    lot_size: int = 50,
) -> Instrument:
    canonical_id = (
        f"NSE_FNO:OPTION:OPTION:{underlying}:{expiry.isoformat()}:"
        f"{int(strike)}:{option_type}"
    )
    inst = Instrument(
        canonical_id=canonical_id,
        exchange="NSE_FNO",
        segment="OPTION",
        instrument_type="OPTION",
        symbol_root=underlying,
        display_symbol=f"{underlying} {expiry:%d %b %Y} {int(strike)} {option_type}",
        underlying=underlying,
        expiry=expiry,
        strike=strike,
        option_type=option_type,
        lot_size=lot_size,
        tick_size=0.05,
        isin=None,
        is_active=True,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


def _create_future(
    db: Session,
    *,
    underlying: str = "NIFTY",
    expiry: date = date(2026, 5, 29),
    lot_size: int = 50,
) -> Instrument:
    canonical_id = f"NSE_FNO:FUTURE:FUTURE:{underlying}:{expiry.isoformat()}"
    inst = Instrument(
        canonical_id=canonical_id,
        exchange="NSE_FNO",
        segment="FUTURE",
        instrument_type="FUTURE",
        symbol_root=underlying,
        display_symbol=f"{underlying} {expiry:%d %b %Y} FUT",
        underlying=underlying,
        expiry=expiry,
        strike=None,
        option_type=None,
        lot_size=lot_size,
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
    *,
    inst: Instrument,
    broker_key: str,
    broker_instrument_id: str,
    broker_trading_symbol: str,
) -> None:
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key=broker_key,
            broker_instrument_id=broker_instrument_id,
            broker_trading_symbol=broker_trading_symbol,
            raw={},
            is_active=True,
        )
    )
    db.commit()


def test_fno_preview_option_derives_quantity_from_lots(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="u@example.com", password="pass123")
    _connect_broker(db_session, user_id=user.id, broker_key="angel")
    inst = _create_option(db_session)
    _map_instrument(
        db_session,
        inst=inst,
        broker_key="angel",
        broker_instrument_id="1594",
        broker_trading_symbol="NIFTY05MAY2620100CE",
    )

    access = _login(client, "u@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/fno/preview",
        json={
            "broker": "angel",
            "instrument_type": "OPTION",
            "underlying": "NIFTY",
            "expiry": "2026-05-05",
            "strike": 2010000,
            "option_type": "CE",
            "side": "BUY",
            "lots": 2,
            "product": "NRML",
            "order_type": "LIMIT",
            "limit_price": 123.45,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["quantity"] == 100
    assert data["lots"] == 2
    assert data["routing"]["exchange"] == "NFO"


def test_fno_preview_future_requires_no_strike(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="u2@example.com", password="pass123")
    _connect_broker(db_session, user_id=user.id, broker_key="angel")
    inst = _create_future(db_session)
    _map_instrument(
        db_session,
        inst=inst,
        broker_key="angel",
        broker_instrument_id="26000",
        broker_trading_symbol="NIFTY26MAYFUT",
    )

    access = _login(client, "u2@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/fno/preview",
        json={
            "broker": "angel",
            "instrument_type": "FUTURE",
            "underlying": "NIFTY",
            "expiry": "2026-05-29",
            "side": "SELL",
            "lots": 1,
            "product": "MIS",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    assert resp.json()["quantity"] == 50


def test_fno_create_places_order_with_mocked_angel(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u3@example.com", password="pass123")
    _connect_broker(db_session, user_id=user.id, broker_key="angel")
    inst = _create_option(db_session, strike=2020000, option_type="PE")
    _map_instrument(
        db_session,
        inst=inst,
        broker_key="angel",
        broker_instrument_id="20001",
        broker_trading_symbol="NIFTY05MAY2620200PE",
    )

    monkeypatch.setattr(
        "app.brokers.angel_adapter.place_order",
        lambda **_: "ANGEL_FNO_ORDER_1",
    )

    access = _login(client, "u3@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/fno",
        json={
            "broker": "angel",
            "instrument_type": "OPTION",
            "underlying": "NIFTY",
            "expiry": "2026-05-05",
            "strike": 2020000,
            "option_type": "PE",
            "side": "BUY",
            "lots": 1,
            "product": "NRML",
            "order_type": "LIMIT",
            "limit_price": 99.0,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ACKNOWLEDGED"
    assert data["broker_order_id"] == "ANGEL_FNO_ORDER_1"
    assert data["preview"]["quantity"] == 50
    assert data["correlation_id"]

    created = db_session.query(Order).filter(Order.id == data["order_id"]).one()
    assert created.correlation_id == data["correlation_id"]
    assert created.blocked_reason_code is None
    assert created.failure_reason_code is None
    assert created.execution_intent_json is not None
    entry = created.execution_intent_json.get("entry", {})
    assert entry.get("canonical_id") == inst.canonical_id
    assert entry.get("lots") == 1


def test_fno_create_blocks_when_session_missing(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u_block_fno@example.com", password="pass123")

    # Configured + enabled, but missing session.
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

    inst = _create_option(db_session, strike=2030000, option_type="CE")
    _map_instrument(
        db_session,
        inst=inst,
        broker_key="angel",
        broker_instrument_id="20002",
        broker_trading_symbol="NIFTY05MAY2620300CE",
    )

    def _no_dispatch(**_):  # type: ignore[no-untyped-def]
        raise AssertionError("dispatch should not be attempted")

    monkeypatch.setattr("app.brokers.angel_adapter.place_order", _no_dispatch)

    access = _login(client, "u_block_fno@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/fno",
        json={
            "broker": "angel",
            "instrument_type": "OPTION",
            "underlying": "NIFTY",
            "expiry": "2026-05-05",
            "strike": 2030000,
            "option_type": "CE",
            "side": "BUY",
            "lots": 1,
            "product": "NRML",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "BLOCKED"
    assert data["blocked_reason_code"] == "BROKER_SESSION_MISSING"


def test_fno_rejects_invalid_product(db_session: Session, client: TestClient) -> None:
    user = _create_user(db_session, email="u4@example.com", password="pass123")
    _connect_broker(db_session, user_id=user.id, broker_key="angel")
    inst = _create_option(db_session)
    _map_instrument(
        db_session,
        inst=inst,
        broker_key="angel",
        broker_instrument_id="1594",
        broker_trading_symbol="NIFTY05MAY2620100CE",
    )

    access = _login(client, "u4@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders/fno/preview",
        json={
            "broker": "angel",
            "instrument_type": "OPTION",
            "underlying": "NIFTY",
            "expiry": "2026-05-05",
            "strike": 2010000,
            "option_type": "CE",
            "side": "BUY",
            "lots": 1,
            "product": "CNC",
            "order_type": "LIMIT",
            "limit_price": 1.0,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 400
