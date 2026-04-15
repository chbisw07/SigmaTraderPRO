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


def _ensure_equity(db: Session) -> Instrument:
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
        isin="INE009A01021",
        is_active=True,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="NSE:1594",
            broker_trading_symbol="INFY-EQ",
            raw={},
            is_active=True,
        )
    )
    db.commit()
    return inst


def _ensure_option(db: Session) -> Instrument:
    inst = Instrument(
        canonical_id="NSE_FNO:OPTION:OPTION:NIFTY:2026-05-05:2010000:CE",
        exchange="NSE_FNO",
        segment="OPTION",
        instrument_type="OPTION",
        symbol_root="NIFTY",
        display_symbol="NIFTY 05 May 2026 2010000 CE",
        underlying="NIFTY",
        expiry=date(2026, 5, 5),
        strike=2010000,
        option_type="CE",
        lot_size=50,
        tick_size=0.05,
        isin=None,
        is_active=True,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="NFO:26000",
            broker_trading_symbol="NIFTY05MAY2620100CE",
            raw={},
            is_active=True,
        )
    )
    db.commit()
    return inst


def _list_events(client: TestClient, access: str) -> list[dict]:
    resp = client.get(
        "/api/v1/system-events?limit=500",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    return resp.json()["items"]


def test_dispatch_disabled_emits_blocked_events_for_stock_and_fno(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u1@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    eq = _ensure_equity(db_session)
    _ensure_option(db_session)

    settings.orders_dispatch_enabled = False
    try:
        access = _login(client, "u1@example.com", "pass123")
        r1 = client.post(
            "/api/v1/orders",
            json={
                "broker": "angel",
                "canonical_id": eq.canonical_id,
                "side": "BUY",
                "quantity": 1,
                "product": "CNC",
                "order_type": "MARKET",
            },
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r1.status_code == 200
        assert r1.json()["status"] == "BLOCKED"

        r2 = client.post(
            "/api/v1/orders/fno",
            json={
                "broker": "angel",
                "instrument_type": "OPTION",
                "underlying": "NIFTY",
                "expiry": "2026-05-05",
                "strike": 2010000,
                "option_type": "CE",
                "side": "BUY",
                "lots": 1,
                "product": "NRML",
                "order_type": "MARKET",
            },
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "BLOCKED"

        corr1 = r1.json()["correlation_id"]
        corr2 = r2.json()["correlation_id"]
        events = _list_events(client, access)
        msgs = {
            (e["correlation_id"], e["level"], e["category"], e["message"])
            for e in events
        }
        assert (
            corr1,
            "WARNING",
            "order_dispatch",
            "Order dispatch blocked: dispatch disabled",
        ) in msgs
        assert (
            corr2,
            "WARNING",
            "order_dispatch",
            "Order dispatch blocked: dispatch disabled",
        ) in msgs
    finally:
        settings.orders_dispatch_enabled = True


def test_broker_session_missing_emits_blocked_event(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="u2@example.com", password="pass123")
    # configured+enabled, but no session.
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

    eq = _ensure_equity(db_session)
    access = _login(client, "u2@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": eq.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "BLOCKED"
    corr = resp.json()["correlation_id"]

    events = _list_events(client, access)
    assert any(
        e["category"] == "order_dispatch"
        and e["level"] == "WARNING"
        and e["correlation_id"] == corr
        and "broker session missing" in e["message"]
        for e in events
    )


def test_dispatch_failure_emits_started_and_failed_events(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u3@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    eq = _ensure_equity(db_session)

    def _boom(**_):  # type: ignore[no-untyped-def]
        raise RuntimeError("wire down")

    monkeypatch.setattr("app.brokers.angel_adapter.place_order", _boom)

    access = _login(client, "u3@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": eq.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "MIS",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "DISPATCH_FAILED"
    corr = resp.json()["correlation_id"]

    events = _list_events(client, access)
    assert any(
        e["category"] == "order_dispatch"
        and e["level"] == "INFO"
        and e["correlation_id"] == corr
        and e["message"].startswith("Order dispatch started:")
        for e in events
    )
    assert any(
        e["category"] == "order_dispatch"
        and e["level"] == "ERROR"
        and e["correlation_id"] == corr
        and "failed before broker acknowledgement" in e["message"]
        for e in events
    )


def test_acknowledged_emits_started_and_ack_events(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u4@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    eq = _ensure_equity(db_session)

    monkeypatch.setattr(
        "app.brokers.angel_adapter.place_order", lambda **_: "BROKER_OID_1"
    )

    access = _login(client, "u4@example.com", "pass123")
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": eq.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "MIS",
            "order_type": "MARKET",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ACKNOWLEDGED"
    corr = resp.json()["correlation_id"]

    events = _list_events(client, access)
    assert any(
        e["category"] == "order_dispatch"
        and e["level"] == "INFO"
        and e["correlation_id"] == corr
        and e["message"].startswith("Order dispatch started:")
        for e in events
    )
    assert any(
        e["category"] == "order_dispatch"
        and e["level"] == "INFO"
        and e["correlation_id"] == corr
        and e["message"].startswith("Order acknowledged by")
        for e in events
    )
