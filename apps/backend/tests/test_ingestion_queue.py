from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.broker_connection  # noqa: F401
import app.models.ingestion_queue_item  # noqa: F401
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


def _ensure_equity_instrument(db: Session) -> Instrument:
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
            broker_instrument_id="1594",
            broker_trading_symbol="INFY-EQ",
            raw={},
            is_active=True,
        )
    )
    db.commit()
    return inst


def _read_audit_csv_rows() -> list[str]:
    csvs = sorted(settings.audit_csv_dir.glob("ST_*.csv"))
    assert csvs, "Expected audit CSV file to be created"
    return csvs[-1].read_text(encoding="utf-8").splitlines()


def test_queue_create_and_execute_creates_order(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="q@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)

    monkeypatch.setattr(
        "app.brokers.angel_adapter.place_order",
        lambda **_: "ANGEL_ORDER_ID_Q1",
    )

    access = _login(client, "q@example.com", "pass123")
    intent = {
        "version": "1",
        "entry": {
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "product_mode": "delivery",
            "product": "CNC",
            "order_type": "LIMIT",
            "limit_price": 100.0,
            "quantity": 1,
            "lots": None,
            "lot_size": 1,
        },
        "plan": {
            "managed_exits": False,
            "reference_price": 100.0,
            "reference_source": "limit_price",
            "stop_loss": {"price": None, "pct": None},
            "target": {"price": None, "pct": None},
            "trailing_sl": {"enabled": False, "distance": {"price": None, "pct": None}},
        },
        "source_context": "manual",
    }

    resp = client.post(
        "/api/v1/queue",
        json={"source_type": "manual_ui", "execution_intent": intent},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in {"ready", "queued"}
    assert data["canonical_id"] == inst.canonical_id
    queue_id = data["id"]

    exec_resp = client.post(
        f"/api/v1/queue/{queue_id}/execute",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert exec_resp.status_code == 200
    out = exec_resp.json()
    assert out["status"] in {"dispatched", "failed"}
    assert out["dispatched_order_id"]

    created = (
        db_session.query(Order).filter(Order.id == out["dispatched_order_id"]).one()
    )
    assert created.correlation_id == out["correlation_id"]
    assert created.execution_intent_json is not None
    assert (created.dispatch_tags_json or {}).get("queue_id") == str(queue_id)

    rows = _read_audit_csv_rows()
    assert any("queue_created" in r for r in rows)
    assert any("queue_executed" in r for r in rows)


def test_queue_cancel_marks_cancelled(db_session: Session, client: TestClient) -> None:
    user = _create_user(db_session, email="q2@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)
    access = _login(client, "q2@example.com", "pass123")

    intent = {
        "version": "1",
        "entry": {
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "product_mode": "delivery",
            "product": "CNC",
            "order_type": "LIMIT",
            "limit_price": 100.0,
            "quantity": 1,
            "lots": None,
            "lot_size": 1,
        },
        "plan": {
            "managed_exits": False,
            "reference_price": 100.0,
            "reference_source": "limit_price",
            "stop_loss": {"price": None, "pct": None},
            "target": {"price": None, "pct": None},
            "trailing_sl": {"enabled": False, "distance": {"price": None, "pct": None}},
        },
    }
    resp = client.post(
        "/api/v1/queue",
        json={"source_type": "manual_ui", "execution_intent": intent},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    qid = resp.json()["id"]

    cancel = client.post(
        f"/api/v1/queue/{qid}/cancel",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"


def test_queue_idempotency_key_duplicate_rejected(
    db_session: Session, client: TestClient
) -> None:
    user = _create_user(db_session, email="q3@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session)
    access = _login(client, "q3@example.com", "pass123")

    idem = "idem_test_1"
    intent = {
        "version": "1",
        "entry": {
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "product_mode": "delivery",
            "product": "CNC",
            "order_type": "LIMIT",
            "limit_price": 100.0,
            "quantity": 1,
            "lots": None,
            "lot_size": 1,
        },
        "plan": {
            "managed_exits": False,
            "reference_price": 100.0,
            "reference_source": "limit_price",
            "stop_loss": {"price": None, "pct": None},
            "target": {"price": None, "pct": None},
            "trailing_sl": {"enabled": False, "distance": {"price": None, "pct": None}},
        },
        "source_context": "manual",
    }

    resp1 = client.post(
        "/api/v1/queue",
        json={
            "source_type": "manual_ui",
            "idempotency_key": idem,
            "execution_intent": intent,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp1.status_code == 200

    resp2 = client.post(
        "/api/v1/queue",
        json={
            "source_type": "manual_ui",
            "idempotency_key": idem,
            "execution_intent": intent,
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 409
