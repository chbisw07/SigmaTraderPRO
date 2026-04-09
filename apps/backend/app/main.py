from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.v1.router import api_router as v1_router
from app.core.config import settings
from app.core.csv_audit import CsvAuditConfig, CsvAuditLogger
from app.core.diagnostics import startup_diagnostics
from app.core.logger import configure_logging, get_logger, log_event

configure_logging(level=settings.log_level, log_format=settings.log_format)  # type: ignore[arg-type]
logger = get_logger(__name__)


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        settings.audit_csv_dir.mkdir(parents=True, exist_ok=True)

        app.state.csv_audit = CsvAuditLogger(
            CsvAuditConfig(
                directory=settings.audit_csv_dir,
                prefix="ST",
                max_bytes=settings.audit_csv_max_bytes,
            )
        )

        diag = startup_diagnostics(settings)
        log_event(
            logger,
            "startup",
            event_type="startup",
            category="system",
            diagnostics=diag,
            postgres_configured=diag["persistence"]["postgres_configured"],
            redis_configured=diag["persistence"]["redis_configured"],
        )
        yield

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(v1_router)
    return app


app = create_app()
