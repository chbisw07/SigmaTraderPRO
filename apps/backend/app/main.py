from __future__ import annotations

from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.v1.router import api_router as v1_router
from app.api.webhooks import router as webhooks_router
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
                retention_days=settings.audit_csv_retention_days,
            )
        )
        # Best-effort cleanup on startup (also runs lazily during audit writes).
        with suppress(Exception):
            app.state.csv_audit.cleanup_old_files(
                keep_days=int(settings.audit_csv_retention_days)
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
    app.include_router(webhooks_router)
    app.include_router(v1_router)
    return app


app = create_app()
