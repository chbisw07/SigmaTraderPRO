from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
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
def client(db_session: Session, tmp_path: Path):
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


def _create_user(db: Session, *, email: str, password: str) -> User:
    user = User(email=email, password_hash=hash_password(password), is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_login_success_and_me(client: TestClient, db_session: Session) -> None:
    _create_user(db_session, email="user@example.com", password="pass123")

    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "pass123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "user@example.com"

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == "user@example.com"


def test_login_failure(client: TestClient, db_session: Session) -> None:
    _create_user(db_session, email="user2@example.com", password="pass123")
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "user2@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_refresh_success(client: TestClient, db_session: Session) -> None:
    _create_user(db_session, email="user3@example.com", password="pass123")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "user3@example.com", "password": "pass123"},
    )
    assert login.status_code == 200
    refresh_token = login.json()["refresh_token"]

    refreshed = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_token}
    )
    assert refreshed.status_code == 200
    assert "access_token" in refreshed.json()
    assert "refresh_token" in refreshed.json()


def test_me_rejects_invalid_token(client: TestClient) -> None:
    resp = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_preferences_update(client: TestClient, db_session: Session) -> None:
    _create_user(db_session, email="user4@example.com", password="pass123")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "user4@example.com", "password": "pass123"},
    )
    access = login.json()["access_token"]

    updated = client.patch(
        "/api/v1/auth/me/preferences",
        headers={"Authorization": f"Bearer {access}"},
        json={"last_used_broker": "angelone"},
    )
    assert updated.status_code == 200
    assert updated.json()["last_used_broker"] == "angelone"
