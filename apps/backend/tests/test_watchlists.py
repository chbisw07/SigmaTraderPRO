from __future__ import annotations

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
import app.models.watchlist  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.base import Base
from app.models.instrument import Instrument
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


def _add_equity(db: Session, canonical_id: str) -> None:
    root = canonical_id.split(":")[-1]
    db.add(
        Instrument(
            canonical_id=canonical_id,
            exchange="NSE_EQ",
            segment="EQUITY",
            instrument_type="EQUITY",
            symbol_root=root,
            display_symbol=root,
            underlying=None,
            expiry=None,
            strike=None,
            option_type=None,
            lot_size=1,
            tick_size=0.05,
            isin=None,
            is_active=True,
        )
    )
    db.commit()


def test_watchlists_default_created_and_crud(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u@example.com", password="pass123")
    access = _login(client, "u@example.com", "pass123")

    resp = client.get(
        "/api/v1/watchlists",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Default"
    assert items[0]["is_default"] is True
    default_id = items[0]["id"]

    # Create another watchlist and set it default.
    resp2 = client.post(
        "/api/v1/watchlists",
        json={"name": "FNO", "make_default": True},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 201
    wl2 = resp2.json()
    assert wl2["name"] == "FNO"
    assert wl2["is_default"] is True

    resp3 = client.get(
        "/api/v1/watchlists",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp3.status_code == 200
    names = {w["name"]: w for w in resp3.json()["items"]}
    assert names["FNO"]["is_default"] is True
    assert names["Default"]["is_default"] is False

    # Rename.
    resp4 = client.patch(
        f"/api/v1/watchlists/{wl2['id']}",
        json={"name": "F&O"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp4.status_code == 200
    assert resp4.json()["name"] == "F&O"

    # Delete F&O; default should re-exist.
    resp5 = client.delete(
        f"/api/v1/watchlists/{wl2['id']}",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp5.status_code == 204

    resp6 = client.get(
        "/api/v1/watchlists",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp6.status_code == 200
    assert len(resp6.json()["items"]) == 1
    assert resp6.json()["items"][0]["is_default"] is True

    # Existing default id may change if recreated; ensure endpoint still works.
    resp7 = client.get(
        f"/api/v1/watchlists/{default_id}/items",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp7.status_code in {200, 404}


def test_watchlist_add_remove_and_reorder_items(
    db_session: Session, client: TestClient
) -> None:
    _create_user(db_session, email="u2@example.com", password="pass123")
    _add_equity(db_session, "NSE_EQ:EQUITY:EQUITY:INFY")
    _add_equity(db_session, "NSE_EQ:EQUITY:EQUITY:TCS")
    access = _login(client, "u2@example.com", "pass123")

    wls = client.get(
        "/api/v1/watchlists",
        headers={"Authorization": f"Bearer {access}"},
    ).json()["items"]
    wl_id = wls[0]["id"]

    add1 = client.post(
        f"/api/v1/watchlists/{wl_id}/items",
        json={"canonical_id": "NSE_EQ:EQUITY:EQUITY:INFY"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert add1.status_code == 201
    add2 = client.post(
        f"/api/v1/watchlists/{wl_id}/items",
        json={"canonical_id": "NSE_EQ:EQUITY:EQUITY:TCS"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert add2.status_code == 201

    items = client.get(
        f"/api/v1/watchlists/{wl_id}/items",
        headers={"Authorization": f"Bearer {access}"},
    ).json()["items"]
    assert [i["canonical_id"] for i in items] == [
        "NSE_EQ:EQUITY:EQUITY:INFY",
        "NSE_EQ:EQUITY:EQUITY:TCS",
    ]

    # Reorder (swap).
    reorder = client.post(
        f"/api/v1/watchlists/{wl_id}/items/reorder",
        json={"item_ids": [items[1]["id"], items[0]["id"]]},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert reorder.status_code == 200

    items2 = client.get(
        f"/api/v1/watchlists/{wl_id}/items",
        headers={"Authorization": f"Bearer {access}"},
    ).json()["items"]
    assert [i["canonical_id"] for i in items2] == [
        "NSE_EQ:EQUITY:EQUITY:TCS",
        "NSE_EQ:EQUITY:EQUITY:INFY",
    ]

    # Remove.
    rm = client.delete(
        f"/api/v1/watchlists/{wl_id}/items/{items2[0]['id']}",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert rm.status_code == 204

    items3 = client.get(
        f"/api/v1/watchlists/{wl_id}/items",
        headers={"Authorization": f"Bearer {access}"},
    ).json()["items"]
    assert len(items3) == 1
