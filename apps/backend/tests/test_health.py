from fastapi.testclient import TestClient

from app.main import app


def test_health_ok() -> None:
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_readiness_degrades_gracefully() -> None:
    client = TestClient(app)
    resp = client.get("/health/ready")
    assert resp.status_code in (200, 503)
    payload = resp.json()

    assert payload["status"] in ("ready", "not_ready")
    assert "postgres" in payload
    assert "redis" in payload
    assert isinstance(payload["postgres"]["ok"], bool)
    assert isinstance(payload["redis"]["ok"], bool)
