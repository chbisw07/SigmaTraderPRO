from __future__ import annotations

from typing import Any

import redis
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.redis_client import get_redis
from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness() -> JSONResponse:
    postgres_ok = False
    postgres_error: str | None = None
    schema_ok = False
    schema_error: str | None = None

    redis_ok = False
    redis_error: str | None = None

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            # Basic schema guardrail (helps catch "forgot to migrate" early).
            required = [
                "users",
                "broker_connections",
                "instruments",
                "orders",
                "positions",
            ]
            missing: list[str] = []
            for name in required:
                row = conn.execute(
                    text("SELECT to_regclass(:t)"),
                    {"t": name},
                ).fetchone()
                if not row or row[0] is None:
                    missing.append(name)
            if missing:
                schema_ok = False
                schema_error = f"missing tables: {', '.join(missing)} (run migrations)"
            else:
                schema_ok = True
        postgres_ok = True
    except Exception as exc:  # noqa: BLE001 - readiness must degrade gracefully
        postgres_error = str(exc)

    try:
        client = get_redis()
        client.ping()
        redis_ok = True
    except redis.RedisError as exc:
        redis_error = str(exc)
    except Exception as exc:  # noqa: BLE001 - readiness must degrade gracefully
        redis_error = str(exc)

    ready = postgres_ok and redis_ok and schema_ok
    payload: dict[str, Any] = {
        "status": "ready" if ready else "not_ready",
        "postgres": {"ok": postgres_ok, "error": postgres_error},
        "schema": {"ok": schema_ok, "error": schema_error},
        "redis": {"ok": redis_ok, "error": redis_error},
    }
    return JSONResponse(status_code=200 if ready else 503, content=payload)
