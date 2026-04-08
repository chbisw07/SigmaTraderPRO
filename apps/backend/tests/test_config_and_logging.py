from __future__ import annotations

from datetime import UTC, datetime

from app.core.config import Settings
from app.core.csv_audit import CsvAuditConfig, CsvAuditLogger
from app.core.diagnostics import startup_diagnostics
from app.core.logger import get_logger, log_event
from app.core.sanitization import redact_url_password, sanitize


def test_settings_load_from_env_file(tmp_path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "APP_NAME=SigmaTraderPRO",
                "APP_ENV=development",
                "APP_HOST=127.0.0.1",
                "APP_PORT=8000",
                "LOG_LEVEL=DEBUG",
                "LOG_FORMAT=json",
                f"LOG_DIR={tmp_path / 'logs'}",
                f"AUDIT_CSV_DIR={tmp_path / 'audit'}",
                "AUDIT_CSV_MAX_BYTES=1234",
                "DATABASE_URL=postgresql+psycopg://u:p@127.0.0.1:5432/db",
                "REDIS_URL=redis://127.0.0.1:6379/0",
                "",
            ]
        ),
        encoding="utf-8",
    )

    s = Settings(_env_file=env_file, _env_file_encoding="utf-8")
    assert s.log_level == "DEBUG"
    assert s.audit_csv_max_bytes == 1234


def test_startup_diagnostics_are_safe() -> None:
    s = Settings(
        app_name="SigmaTraderPRO",
        app_env="development",
        app_host="127.0.0.1",
        app_port=8000,
        database_url="postgresql+psycopg://user:password@localhost:5432/db",
        redis_url="redis://localhost:6379/0",
    )
    diag = startup_diagnostics(s)
    assert "password" not in str(diag).lower()
    assert diag["persistence"]["postgres_configured"] is True
    assert diag["persistence"]["redis_configured"] is True


def test_logger_smoke() -> None:
    logger = get_logger("test")
    log_event(logger, "hello", event_type="smoke", token="abc123")


def test_sanitization_redacts_sensitive_keys() -> None:
    payload = {"token": "abc", "nested": {"password": "p"}, "ok": 1}
    sanitized = sanitize(payload)
    assert sanitized["token"] == "***REDACTED***"
    assert sanitized["nested"]["password"] == "***REDACTED***"
    assert sanitized["ok"] == 1


def test_redact_url_password_best_effort() -> None:
    url = "postgresql+psycopg://user:password@localhost:5432/db"
    assert "password" not in redact_url_password(url)


def test_csv_audit_logger_writes_and_redacts(tmp_path) -> None:
    fixed = datetime(2026, 4, 9, 12, 0, 0, tzinfo=UTC)

    audit = CsvAuditLogger(
        CsvAuditConfig(
            directory=tmp_path, prefix="ST", max_bytes=10_000, now=lambda: fixed
        )
    )
    path = audit.log(
        level="INFO",
        module="test",
        category="system",
        event_type="startup",
        message="hello",
        details={"access_token": "secret-token", "ok": True},
    )

    content = path.read_text(encoding="utf-8")
    assert "ST_20260409" in path.name
    assert "access_token" in content
    assert "secret-token" not in content
