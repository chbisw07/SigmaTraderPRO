from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.ingestion_queue_item  # noqa: F401
import app.models.instrument  # noqa: F401
import app.models.instrument_mapping  # noqa: F401
import app.models.order  # noqa: F401
import app.models.system_event  # noqa: F401
import app.models.user  # noqa: F401
import app.models.webhook_ingestion  # noqa: F401
import app.models.webhook_route  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.ingestion_queue_item import IngestionQueueItem
from app.models.system_event import SystemEvent
from app.models.user import User
from app.models.webhook_ingestion import WebhookIngestion


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
    settings.tradingview_route_token = "TV_TOKEN"
    settings.tradingview_supported_schema_versions = "1"

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _create_user(db: Session) -> None:
    user = User(
        email="u@example.com",
        password_hash=hash_password("pass123"),
        is_active=True,
    )
    db.add(user)
    db.commit()


def _payload(**overrides):
    base = {
        "route_token": "TV_TOKEN",
        "schema_version": "1",
        "alert_id": "A1",
        "strategy_id": "S1",
        "strategy_name": "Demo",
        "symbol": "NSE:INFY",
        "order_action": "buy",
        "order_type": "market",
        "product": "mis",
        "qty": 1,
        "price": 123.45,
        "timeframe": "5",
        "alert_timestamp": "2026-04-11T12:00:00Z",
    }
    base.update(overrides)
    return base


def test_valid_webhook_accepted_and_persisted(db_session: Session, client: TestClient):
    _create_user(db_session)
    resp = client.post("/webhook/tradingview", json=_payload())
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["status"] == "accepted"
    assert data["correlation_id"]
    assert data["idempotency_key"]
    assert data["queue_item_id"]

    rows = db_session.query(WebhookIngestion).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "accepted"
    assert row.source == "tradingview"
    assert row.correlation_id == data["correlation_id"]
    assert row.idempotency_key == data["idempotency_key"]
    assert row.raw_payload_json.get("route_token") == "***"
    assert row.normalized_payload_json
    assert row.normalized_payload_json["symbol"] == "INFY"
    assert row.normalized_payload_json["exchange"] == "NSE"
    assert row.normalized_payload_json["side"] == "BUY"
    assert row.normalized_payload_json["product"] == "MIS"

    events = (
        db_session.query(SystemEvent)
        .filter(SystemEvent.category == "webhook_tradingview")
        .all()
    )
    messages = {e.message for e in events}
    assert "TradingView webhook received" in messages
    assert "TradingView webhook accepted" in messages
    assert "TradingView webhook enqueued" in messages

    q = db_session.query(IngestionQueueItem).one()
    assert q.source_type == "tradingview"
    assert q.idempotency_key == data["idempotency_key"]


def test_missing_token_rejected(db_session: Session, client: TestClient):
    p = _payload()
    p.pop("route_token", None)
    resp = client.post("/webhook/tradingview", json=p)
    assert resp.status_code == 401
    data = resp.json()
    assert data["ok"] is False
    assert data["reason_code"] == "WEBHOOK_TOKEN_MISSING"
    assert data["correlation_id"]

    assert db_session.query(WebhookIngestion).count() == 1


def test_invalid_token_rejected(db_session: Session, client: TestClient):
    resp = client.post("/webhook/tradingview", json=_payload(route_token="BAD"))
    assert resp.status_code == 403
    data = resp.json()
    assert data["ok"] is False
    assert data["reason_code"] == "WEBHOOK_TOKEN_INVALID"
    assert db_session.query(WebhookIngestion).count() == 1


def test_schema_missing_rejected(db_session: Session, client: TestClient):
    p = _payload()
    p.pop("schema_version", None)
    resp = client.post("/webhook/tradingview", json=p)
    assert resp.status_code == 400
    data = resp.json()
    assert data["reason_code"] == "WEBHOOK_SCHEMA_VERSION_MISSING"
    assert data["idempotency_key"]
    assert db_session.query(WebhookIngestion).count() == 1


def test_schema_unsupported_rejected(db_session: Session, client: TestClient):
    resp = client.post("/webhook/tradingview", json=_payload(schema_version="99"))
    assert resp.status_code == 400
    data = resp.json()
    assert data["reason_code"] == "WEBHOOK_SCHEMA_VERSION_UNSUPPORTED"
    assert db_session.query(WebhookIngestion).count() == 1


def test_duplicate_webhook_ignored(db_session: Session, client: TestClient):
    _create_user(db_session)
    resp1 = client.post("/webhook/tradingview", json=_payload(alert_id="DUP1"))
    assert resp1.status_code == 200
    corr1 = resp1.json()["correlation_id"]
    idem = resp1.json()["idempotency_key"]

    resp2 = client.post("/webhook/tradingview", json=_payload(alert_id="DUP1"))
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "duplicate_ignored"
    assert data2["duplicate_ignored"] is True
    assert data2["idempotency_key"] == idem
    assert data2["correlation_id"] == corr1

    assert db_session.query(WebhookIngestion).count() == 1


def test_malformed_json_rejected(db_session: Session, client: TestClient):
    resp = client.post(
        "/webhook/tradingview",
        data="{bad json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["reason_code"] == "WEBHOOK_INVALID_PAYLOAD"
    assert data["correlation_id"]
    assert db_session.query(WebhookIngestion).count() == 1


def test_normalizes_alternate_field_names_and_case(
    db_session: Session, client: TestClient
):
    _create_user(db_session)
    p = _payload(
        alert_id="ALT1",
        symbol="infy",
        exchange="nse",
        txn_type="SELL",
        quantity=2,
        order_type="LIMIT",
        product="CNC",
        price=1500,
    )
    p.pop("order_action", None)
    p.pop("qty", None)
    resp = client.post("/webhook/tradingview", json=p)
    assert resp.status_code == 200

    row = db_session.query(WebhookIngestion).one()
    norm = row.normalized_payload_json or {}
    assert norm["symbol"] == "INFY"
    assert norm["exchange"] == "NSE"
    assert norm["side"] == "SELL"
    assert norm["quantity"] == 2
    assert norm["order_type"] == "LIMIT"


def test_rejects_invalid_enums(db_session: Session, client: TestClient):
    _create_user(db_session)
    resp = client.post("/webhook/tradingview", json=_payload(product="NOPE"))
    assert resp.status_code == 400
    data = resp.json()
    assert data["reason_code"] == "WEBHOOK_INVALID_PAYLOAD"
