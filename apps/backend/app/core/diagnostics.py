from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from app.core.config import BACKEND_ROOT, Settings


def safe_path(path: Path) -> str:
    try:
        if path.is_absolute() and BACKEND_ROOT in path.parents:
            return str(path.relative_to(BACKEND_ROOT))
    except Exception:  # noqa: BLE001 - diagnostics must be best-effort
        pass
    return str(path)


def startup_diagnostics(settings: Settings) -> dict[str, Any]:
    return {
        "app": {
            "name": settings.app_name,
            "env": settings.app_env,
            "host": settings.app_host,
            "port": settings.app_port,
        },
        "auth": {
            "jwt_secret_configured": bool(settings.jwt_secret_key)
            and settings.jwt_secret_key
            != "dev-insecure-change-me-please-use-32-bytes-min",
            "jwt_algorithm": settings.jwt_algorithm,
            "access_token_expire_minutes": settings.access_token_expire_minutes,
            "refresh_token_expire_minutes": settings.refresh_token_expire_minutes,
        },
        "persistence": {
            "postgres_configured": bool(settings.database_url),
            "redis_configured": bool(settings.redis_url),
        },
        "logging": {
            "level": settings.log_level,
            "format": settings.log_format,
            "log_dir": safe_path(Path(settings.log_dir)),
            "audit_csv_dir": safe_path(Path(settings.audit_csv_dir)),
            "audit_csv_max_bytes": settings.audit_csv_max_bytes,
        },
        "runtime": {
            "pid": os.getpid(),
            "python": sys.version.split()[0],
        },
    }
