from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class AngelSessionTokens:
    jwt_token: str
    refresh_token: str
    feed_token: str | None = None


class AngelAuthError(RuntimeError):
    pass


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-ClientLocalIP": settings.angel_client_local_ip,
        "X-ClientPublicIP": settings.angel_client_public_ip,
        "X-MACAddress": settings.angel_mac_address,
        "X-PrivateKey": api_key,
        "X-UserType": "USER",
        "X-SourceID": "WEB",
    }


def login_by_password(
    *,
    api_key: str,
    client_code: str,
    password: str,
    totp: str,
) -> AngelSessionTokens:
    # Endpoint is based on Angel One SmartAPI public docs.
    url = (
        "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword"
    )
    payload = {"clientcode": client_code, "password": password, "totp": totp}

    try:
        with httpx.Client(timeout=settings.angel_http_timeout_seconds) as client:
            resp = client.post(url, json=payload, headers=_headers(api_key))
    except httpx.HTTPError as exc:
        raise AngelAuthError("Angel auth transport error") from exc

    if resp.status_code != 200:
        raise AngelAuthError(f"Angel auth failed ({resp.status_code})")

    data: dict[str, Any] = resp.json()
    if data.get("status") is not True:
        msg = str(data.get("message") or "Angel auth failed")
        raise AngelAuthError(msg)

    inner = data.get("data") or {}
    jwt_token = inner.get("jwtToken")
    refresh_token = inner.get("refreshToken")
    feed_token = inner.get("feedToken")

    if not jwt_token or not refresh_token:
        raise AngelAuthError("Angel auth response missing tokens")

    return AngelSessionTokens(
        jwt_token=str(jwt_token),
        refresh_token=str(refresh_token),
        feed_token=str(feed_token) if feed_token else None,
    )
