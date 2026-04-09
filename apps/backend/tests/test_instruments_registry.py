from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.instrument  # noqa: F401
import app.models.instrument_mapping  # noqa: F401
from app.brokers.types import BrokerKey
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.user import User
from app.services.instrument_registry_service import instrument_registry_service
from app.services.instrument_sync_service import instrument_sync_service


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


def test_sync_idempotent_and_search_api(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u@example.com", password="pass123")
    access = _login(client, "u@example.com", "pass123")

    rows = [
        {
            "exch_seg": "NSE",
            "symbol": "INFY-EQ",
            "name": "INFY",
            "instrumenttype": "EQ",
            "token": "1594",
            "lotsize": "1",
            "tick_size": "0.05",
            "isin": "INE009A01021",
        },
        {
            "exch_seg": "NFO",
            "symbol": "NIFTY25APR2026FUT",
            "name": "NIFTY",
            "instrumenttype": "FUTIDX",
            "token": "1001",
            "expiry": "25APR2026",
            "lotsize": "50",
            "tick_size": "0.05",
        },
        {
            "exch_seg": "NFO",
            "symbol": "NIFTY25APR202623100CE",
            "name": "NIFTY",
            "instrumenttype": "OPTIDX",
            "token": "2001",
            "expiry": "25APR2026",
            "strike": "23100",
            "optiontype": "CE",
            "lotsize": "50",
            "tick_size": "0.05",
        },
    ]

    result1 = instrument_sync_service.sync_angel_rows(db_session, rows)
    assert result1.ingested == 3

    result2 = instrument_sync_service.sync_angel_rows(db_session, rows)
    assert result2.ingested == 3

    assert db_session.query(Instrument).count() == 3
    assert db_session.query(InstrumentMapping).count() == 3

    search = client.get(
        "/api/v1/instruments/search",
        params={"q": "nifty"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert search.status_code == 200
    data = search.json()
    assert "items" in data
    assert len(data["items"]) >= 2
    assert all("broker" not in item for item in data["items"])

    eq = client.get(
        "/api/v1/instruments/search",
        params={"q": "infy"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert eq.status_code == 200
    items = eq.json()["items"]
    assert len(items) == 1
    assert items[0]["canonical_id"].startswith("NSE_EQ:EQUITY:EQUITY:INFY")

    detail = client.get(
        f"/api/v1/instruments/{items[0]['canonical_id']}",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert detail.status_code == 200
    assert detail.json()["symbol_root"] == "INFY"

    expiries = client.get(
        "/api/v1/instruments/derivatives/expiries",
        params={
            "underlying": "NIFTY",
            "exchange": "NSE_FNO",
            "instrument_type": "OPTION",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert expiries.status_code == 200
    exp_data = expiries.json()
    assert exp_data["underlying"] == "NIFTY"
    assert "2026-04-25" in [str(d) for d in exp_data["expiries"]]

    strikes = client.get(
        "/api/v1/instruments/derivatives/strikes",
        params={
            "underlying": "NIFTY",
            "exchange": "NSE_FNO",
            "expiry": "2026-04-25",
            "option_type": "CE",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert strikes.status_code == 200
    strike_data = strikes.json()
    assert strike_data["strikes"] == [23100.0]

    option_chain = client.get(
        "/api/v1/instruments/derivatives/options",
        params={
            "underlying": "NIFTY",
            "exchange": "NSE_FNO",
            "expiry": "2026-04-25",
            "option_type": "CE",
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert option_chain.status_code == 200
    option_items = option_chain.json()["items"]
    assert len(option_items) == 1
    assert option_items[0]["strike"] == 23100.0
    assert option_items[0]["option_type"] == "CE"

    mapping = instrument_registry_service.resolve_for_broker(
        db_session,
        canonical_id=items[0]["canonical_id"],
        broker=BrokerKey.angel,
    )
    assert mapping is not None
    assert mapping.broker_trading_symbol == "INFY-EQ"


def test_sync_endpoint_validates_payload(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u2@example.com", password="pass123")
    access = _login(client, "u2@example.com", "pass123")

    bad = client.post(
        "/api/v1/instruments/sync/angel-master",
        json={"scope": "nope"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert bad.status_code == 422

    missing = client.post(
        "/api/v1/instruments/sync/angel-master",
        json={"scope": "fno_underlyings"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert missing.status_code == 400
