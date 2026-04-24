from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.instrument  # noqa: F401
import app.models.instrument_mapping  # noqa: F401
import app.models.position  # noqa: F401
import app.models.user  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.user import User
from app.orders.types import ExternalBrokerPosition


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


def _ensure_instrument(db: Session, canonical_id: str) -> Instrument:
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


def _map_instrument_zerodha(db: Session, inst: Instrument) -> None:
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="zerodha",
            broker_instrument_id="123",
            broker_trading_symbol=inst.symbol_root,
            raw={},
            is_active=True,
        )
    )
    db.commit()


def _map_instrument_angel(db: Session, inst: Instrument) -> None:
    db.add(
        InstrumentMapping(
            instrument_id=inst.id,
            broker_key="angel",
            broker_instrument_id="NSE:1467",
            broker_trading_symbol=f"{inst.symbol_root}-EQ",
            raw={},
            is_active=True,
        )
    )
    db.commit()


def test_positions_sync_endpoint_upserts_positions(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="p@example.com", password="pass123")
    access = _login(client, "p@example.com", "pass123")

    inst = _ensure_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument_zerodha(db_session, inst)

    class _FakeAdapter:
        display_name = "Zerodha"

        def fetch_positions(self, db, user):
            _ = (db, user)
            return [
                ExternalBrokerPosition(
                    broker="zerodha",
                    broker_position_id="pos-1",
                    exchange="NSE",
                    trading_symbol="INFY",
                    broker_instrument_id="123",
                    net_quantity=10,
                    avg_price=1000.0,
                    last_price=1100.0,
                    realized_pnl=None,
                    unrealized_pnl=1000.0,
                    mtm=1000.0,
                )
            ]

    monkeypatch.setattr(
        "app.services.position_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    sync = client.post(
        "/api/v1/positions/sync?broker=zerodha",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert sync.status_code == 200
    data = sync.json()
    assert data["status"] == "ok"
    assert data["synced"] == 1
    assert data["skipped_unmapped"] == 0

    resp = client.get(
        "/api/v1/positions?broker=zerodha",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["canonical_id"] == inst.canonical_id
    assert items[0]["quantity"] == 10


def test_positions_sync_resolves_angel_cash_tradingsymbol_without_eq_suffix(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="a@example.com", password="pass123")
    access = _login(client, "a@example.com", "pass123")

    inst = _ensure_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:TCS")
    _map_instrument_angel(db_session, inst)

    class _FakeAdapter:
        display_name = "Angel One"

        def fetch_positions(self, db, user):
            _ = (db, user)
            return [
                ExternalBrokerPosition(
                    broker="angel",
                    broker_position_id="pos-1",
                    exchange="NSECM",
                    trading_symbol="TCS",
                    broker_instrument_id=None,
                    net_quantity=5,
                    avg_price=3000.0,
                    last_price=3010.0,
                    realized_pnl=None,
                    unrealized_pnl=50.0,
                    mtm=50.0,
                )
            ]

    monkeypatch.setattr(
        "app.services.position_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    sync = client.post(
        "/api/v1/positions/sync?broker=angel",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert sync.status_code == 200
    assert sync.json()["synced"] == 1
    assert sync.json()["skipped_unmapped"] == 0

    resp = client.get(
        "/api/v1/positions?broker=angel",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["canonical_id"] == inst.canonical_id
    assert items[0]["quantity"] == 5
