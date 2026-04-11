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


class AngelOrderError(RuntimeError):
    pass


class AngelOrderBookError(RuntimeError):
    pass


class AngelPositionBookError(RuntimeError):
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


def place_order(
    *,
    api_key: str,
    jwt_token: str,
    exchange: str,
    trading_symbol: str,
    symbol_token: str,
    transaction_type: str,
    quantity: int,
    product_type: str,
    order_type: str,
    price: float | None,
) -> str:
    url = "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/placeOrder"
    payload: dict[str, Any] = {
        "variety": "NORMAL",
        "tradingsymbol": trading_symbol,
        "symboltoken": symbol_token,
        "transactiontype": transaction_type,
        "exchange": exchange,
        "ordertype": order_type,
        "producttype": product_type,
        "duration": "DAY",
        "quantity": int(quantity),
    }
    if order_type == "LIMIT":
        payload["price"] = float(price or 0)

    headers = _headers(api_key)
    headers["Authorization"] = f"Bearer {jwt_token}"

    try:
        with httpx.Client(timeout=settings.angel_http_timeout_seconds) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise AngelOrderError("Angel order transport error") from exc

    if resp.status_code != 200:
        raise AngelOrderError(f"Angel order failed ({resp.status_code})")

    data: dict[str, Any] = resp.json()
    if data.get("status") is not True:
        msg = str(data.get("message") or "Angel order failed")
        raise AngelOrderError(msg)

    inner = data.get("data") or {}
    order_id = (
        inner.get("orderid") or inner.get("orderId") or inner.get("uniqueorderid")
    )
    if not order_id:
        raise AngelOrderError("Angel order response missing order id")
    return str(order_id)


def fetch_order_book(*, api_key: str, jwt_token: str) -> list[dict[str, Any]]:
    url = (
        "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getOrderBook"
    )
    headers = _headers(api_key)
    headers["Authorization"] = f"Bearer {jwt_token}"

    try:
        with httpx.Client(timeout=settings.angel_http_timeout_seconds) as client:
            resp = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AngelOrderBookError("Angel orderbook transport error") from exc

    if resp.status_code != 200:
        raise AngelOrderBookError(f"Angel orderbook failed ({resp.status_code})")

    data: dict[str, Any] = resp.json()
    if data.get("status") is not True:
        msg = str(data.get("message") or "Angel orderbook failed")
        raise AngelOrderBookError(msg)

    inner = data.get("data") or []
    if not isinstance(inner, list):
        raise AngelOrderBookError("Angel orderbook payload must be a list")
    return [row for row in inner if isinstance(row, dict)]


def fetch_position_book(*, api_key: str, jwt_token: str) -> list[dict[str, Any]]:
    # SmartAPI positions endpoint (best-effort; kept isolated behind adapter).
    url = "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition"
    headers = _headers(api_key)
    headers["Authorization"] = f"Bearer {jwt_token}"

    try:
        with httpx.Client(timeout=settings.angel_http_timeout_seconds) as client:
            resp = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AngelPositionBookError("Angel positionbook transport error") from exc

    if resp.status_code != 200:
        raise AngelPositionBookError(f"Angel positionbook failed ({resp.status_code})")

    data: dict[str, Any] = resp.json()
    if data.get("status") is not True:
        msg = str(data.get("message") or "Angel positionbook failed")
        raise AngelPositionBookError(msg)

    inner = data.get("data") or []
    if not isinstance(inner, list):
        raise AngelPositionBookError("Angel positionbook payload must be a list")
    return [row for row in inner if isinstance(row, dict)]
