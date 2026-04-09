from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import hash_password
from app.core.time import today_ist
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.broker_connection import BrokerConnection
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
    settings.broker_encryption_key = "test-broker-enc-key"
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


def test_angel_status_requires_auth(client: TestClient) -> None:
    resp = client.get("/api/v1/brokers/angel/status")
    assert resp.status_code == 401


def test_angel_status_not_configured(client: TestClient, db_session: Session) -> None:
    _create_user(db_session, email="u@example.com", password="pass123")
    access = _login(client, "u@example.com", "pass123")

    resp = client.get(
        "/api/v1/brokers/angel/status", headers={"Authorization": f"Bearer {access}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "not_configured"
    assert data["configured"] is False


def test_angel_settings_then_connect_and_stale(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _create_user(db_session, email="u2@example.com", password="pass123")
    access = _login(client, "u2@example.com", "pass123")

    settings_resp = client.put(
        "/api/v1/brokers/angel/settings",
        headers={"Authorization": f"Bearer {access}"},
        json={
            "is_enabled": True,
            "api_key": "AK",
            "client_code": "CC",
            "password": "PW",
        },
    )
    assert settings_resp.status_code == 200
    assert settings_resp.json()["state"] in {"configured", "needs_reconnect"}

    # Mock Angel login call (patch adapter import symbol)
    from app.brokers import angel_adapter
    from app.brokers.angel_client import AngelSessionTokens

    def fake_login_by_password(
        *, api_key: str, client_code: str, password: str, totp: str
    ):
        assert api_key == "AK"
        assert client_code == "CC"
        assert password == "PW"
        assert totp == "123456"
        return AngelSessionTokens(jwt_token="JWT", refresh_token="RT", feed_token="FT")

    monkeypatch.setattr(angel_adapter, "login_by_password", fake_login_by_password)

    connect_resp = client.post(
        "/api/v1/brokers/angel/connect",
        headers={"Authorization": f"Bearer {access}"},
        json={"totp": "123456"},
    )
    assert connect_resp.status_code == 200
    assert connect_resp.json()["state"] == "connected"
    assert connect_resp.json()["stale"] is False

    # Simulate next day staleness.
    conn = (
        db_session.query(BrokerConnection)
        .filter(BrokerConnection.broker_key == "angel")
        .one()
    )
    conn.session_day = today_ist() - timedelta(days=1)
    db_session.commit()

    stale_resp = client.get(
        "/api/v1/brokers/angel/status", headers={"Authorization": f"Bearer {access}"}
    )
    assert stale_resp.status_code == 200
    assert stale_resp.json()["state"] == "stale"
    assert stale_resp.json()["stale"] is True
