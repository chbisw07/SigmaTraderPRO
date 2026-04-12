from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.instrument  # noqa: F401
import app.models.instrument_mapping  # noqa: F401
import app.models.user  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
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
        isin="INE009A01021",
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


def test_holdings_endpoint_returns_broker_holdings(
    db_session: Session, client: TestClient, monkeypatch
) -> None:
    _create_user(db_session, email="h@example.com", password="pass123")
    inst = _ensure_equity_instrument(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _map_instrument_zerodha(db_session, inst)

    class _FakeAdapter:
        display_name = "Zerodha"

        def fetch_holdings(self, db, user):
            _ = (db, user)
            return [
                {
                    "tradingsymbol": "INFY",
                    "exchange": "NSE",
                    "isin": "INE009A01021",
                    "quantity": 10,
                    "t1_quantity": 0,
                    "average_price": 1000,
                    "last_price": 1100,
                    "day_change": 10,
                    "day_change_percentage": 0.9,
                }
            ]

    monkeypatch.setattr(
        "app.services.holdings_service.broker_service.get_adapter",
        lambda broker: _FakeAdapter(),
    )

    access = _login(client, "h@example.com", "pass123")
    resp = client.get(
        "/api/v1/holdings?broker=zerodha",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["broker_errors"] == {}
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["broker"] == "zerodha"
    assert item["canonical_id"] == inst.canonical_id
    assert item["quantity"] == 10
    # Computed values are present when price is available.
    assert item["invested_value"] == 10 * 1000
    assert item["current_value"] == 10 * 1100
