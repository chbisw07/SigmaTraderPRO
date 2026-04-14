from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

SENSITIVE_KEY_EXACT = {
    "password",
    "token",
    "secret",
    "api_key",
    "refresh_token",
    "access_token",
    "route_token",
    "jwt_token",
    "feed_token",
    "session_enc",
    "credentials_enc",
    "broker_encryption_key",
}

SENSITIVE_KEY_SUFFIXES = (
    "_password",
    "_token",
    "_secret",
    "_secret_key",
    "_api_key",
    "_jwt_token",
    "_route_token",
    "_access_token",
    "_refresh_token",
)


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in SENSITIVE_KEY_EXACT:
        return True
    return any(lowered.endswith(suffix) for suffix in SENSITIVE_KEY_SUFFIXES)


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


def redact_secrets_in_text(text: str) -> str:
    """
    Best-effort secret redaction for raw text blobs (e.g., invalid JSON request bodies).

    Goals:
    - Never persist plaintext tokens/secrets when we can't parse structured JSON safely.
    - Keep deterministic behavior (pure function) and centralize any pattern handling.

    Notes:
    - This is intentionally conservative and does not attempt to "fix" invalid JSON.
    - It targets common patterns like `"route_token":"..."`, `'token':'...'`, and
      `route_token=...` in querystring-like bodies.
    """
    if not text:
        return text

    # Keep the key list small and explicit to avoid surprising redaction of non-secrets.
    keys = [
        "route_token",
        "access_token",
        "refresh_token",
        "api_key",
        "jwt_token",
        "token",
        "secret",
        "password",
    ]

    out = text
    for key in keys:
        # JSON-ish: "key": "value"  or  'key': 'value'
        out = re.sub(
            rf'(?i)(["\']{re.escape(key)}["\']\s*:\s*["\'])([^"\']*)(["\'])',
            rf"\1{redact_value('')}\3",
            out,
        )
        # Querystring-ish: key=value (until & or whitespace)
        out = re.sub(
            rf"(?i)(\b{re.escape(key)}\b\s*=\s*)([^&\s]+)",
            rf"\1{redact_value('')}",
            out,
        )
        # Generic: key: value (until whitespace/comma/brace) for unquoted values.
        out = re.sub(
            rf"(?i)(\b{re.escape(key)}\b\s*:\s*)([^,\s}}\]]+)",
            rf"\1{redact_value('')}",
            out,
        )

    return out
