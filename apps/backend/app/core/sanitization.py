from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

SENSITIVE_KEYS = (
    "password",
    "token",
    "secret",
    "api_key",
    "refresh_token",
    "access_token",
)


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEYS)


def redact_value(value: Any) -> str:
    _ = value
    return "***REDACTED***"


def redact_url_password(url: str) -> str:
    try:
        parts = urlsplit(url)
    except Exception:  # noqa: BLE001 - sanitization must be best-effort
        return url

    if not parts.username and not parts.password:
        return url

    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"

    if parts.username:
        netloc = f"{parts.username}:***@{netloc}"

    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def sanitize(value: Any) -> Any:
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, inner in value.items():
            key_str = str(key)
            if is_sensitive_key(key_str):
                sanitized[key_str] = redact_value(inner)
            else:
                sanitized[key_str] = sanitize(inner)
        return sanitized

    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]

    if isinstance(value, str):
        if "://" in value:
            return redact_url_password(value)
        return value

    return value


def sanitize_json(value: Any) -> str:
    return json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":"))
