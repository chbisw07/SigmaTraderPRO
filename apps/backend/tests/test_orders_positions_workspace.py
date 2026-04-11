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


def test_orders_and_positions_endpoints_smoke(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    user = _create_user(db_session, email="u@example.com", password="pass123")
    _connect_angel(db_session, user_id=user.id)
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument(db_session, inst)

    monkeypatch.setattr(
        "app.brokers.angel_adapter.place_order",
        lambda **_: "BROKER_ORDER_1",
    )

    access = _login(client, "u@example.com", "pass123")

    # Place a stock order.
    resp = client.post(
        "/api/v1/orders",
        json={
            "broker": "angel",
            "canonical_id": inst.canonical_id,
            "side": "BUY",
            "quantity": 1,
            "product": "CNC",
            "order_type": "LIMIT",
            "limit_price": 10.0,
            "source": "manual_ui",
            "intent_type": "ENTRY",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    order_id = resp.json()["order_id"]

    # Orders list.
    resp2 = client.get(
        "/api/v1/orders?limit=50",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 200
    items = resp2.json()["items"]
    assert len(items) == 1
    assert items[0]["canonical_id"] == inst.canonical_id
    assert items[0]["status"] == "PENDING"

    # Order detail includes snapshots.
    resp3 = client.get(
        f"/api/v1/orders/{order_id}",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp3.status_code == 200
    assert resp3.json()["order"]["id"] == order_id
    assert resp3.json()["preview_snapshot_json"]["canonical_id"] == inst.canonical_id

    # Positions list should include the created position.
    resp4 = client.get(
        "/api/v1/positions",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp4.status_code == 200
    pos_items = resp4.json()["items"]
    assert len(pos_items) == 1
    pos = pos_items[0]
    assert pos["canonical_id"] == inst.canonical_id
    assert pos["side"] == "BUY"
    assert pos["quantity"] == 1

    # Squareoff draft.
    resp5 = client.post(
        f"/api/v1/positions/{pos['id']}/squareoff",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp5.status_code == 200
    assert resp5.json()["draft"]["side"] == "SELL"

    # Repeat draft.
    resp6 = client.post(
        "/api/v1/orders/repeat",
        json={"order_id": order_id},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp6.status_code == 200
    assert resp6.json()["draft"]["instrument"]["canonical_id"] == inst.canonical_id
