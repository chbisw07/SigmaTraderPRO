from __future__ import annotations

from dataclasses import dataclass

from kiteconnect import KiteConnect


@dataclass(frozen=True, slots=True)
class ZerodhaSession:
    access_token: str
    public_token: str | None = None
    user_id: str | None = None


class ZerodhaAuthError(RuntimeError):
    pass


class ZerodhaOrderError(RuntimeError):
    pass


class ZerodhaOrderBookError(RuntimeError):
    pass


class ZerodhaPositionBookError(RuntimeError):
    pass


class ZerodhaQuoteError(RuntimeError):
    pass


class ZerodhaHoldingsError(RuntimeError):
    pass


def get_login_url(*, api_key: str) -> str:
    kite = KiteConnect(api_key=api_key)
    return str(kite.login_url())


def exchange_request_token(
    *,
    api_key: str,
    api_secret: str,
    request_token: str,
) -> ZerodhaSession:
    kite = KiteConnect(api_key=api_key)
    try:
        data = kite.generate_session(request_token, api_secret=api_secret)
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        raise ZerodhaAuthError("Zerodha session generation failed") from exc

    access_token = data.get("access_token")
    if not access_token:
        raise ZerodhaAuthError("Zerodha session response missing access_token")

    return ZerodhaSession(
        access_token=str(access_token),
        public_token=str(data.get("public_token"))
        if data.get("public_token")
        else None,
        user_id=str(data.get("user_id")) if data.get("user_id") else None,
    )


def place_order(
    *,
    api_key: str,
    access_token: str,
    exchange: str,
    trading_symbol: str,
    transaction_type: str,
    quantity: int,
    product: str,
    order_type: str,
    price: float | None,
) -> str:
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    try:
        order_id = kite.place_order(
            variety="regular",
            exchange=exchange,
            tradingsymbol=trading_symbol,
            transaction_type=transaction_type,
            quantity=int(quantity),
            product=product,
            order_type=order_type,
            price=price if price is not None else 0,
            validity="DAY",
        )
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        msg = str(exc).strip().replace("\n", " ")
        if msg:
            msg = msg[:240]
            raise ZerodhaOrderError(f"Zerodha rejected order: {msg}") from exc
        raise ZerodhaOrderError("Zerodha order placement failed") from exc

    if not order_id:
        raise ZerodhaOrderError("Zerodha order placement returned no order_id")
    return str(order_id)


def fetch_orders(*, api_key: str, access_token: str) -> list[dict]:
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    try:
        orders = kite.orders()
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        msg = str(exc).strip().replace("\n", " ")
        msg = msg[:240] if msg else "unknown error"
        raise ZerodhaOrderBookError(f"Zerodha orderbook fetch failed ({msg})") from exc
    if not isinstance(orders, list):
        raise ZerodhaOrderBookError("Zerodha orderbook payload must be a list")
    return orders


def fetch_positions(*, api_key: str, access_token: str) -> list[dict]:
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    try:
        payload = kite.positions()
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        msg = str(exc).strip().replace("\n", " ")
        msg = msg[:240] if msg else "unknown error"
        raise ZerodhaPositionBookError(
            f"Zerodha positionbook fetch failed ({msg})"
        ) from exc

    if not isinstance(payload, dict):
        raise ZerodhaPositionBookError("Zerodha positionbook payload must be a dict")
    net = payload.get("net") or []
    if not isinstance(net, list):
        raise ZerodhaPositionBookError("Zerodha positionbook 'net' must be a list")
    return [row for row in net if isinstance(row, dict)]


def fetch_quotes(*, api_key: str, access_token: str, instruments: list[str]) -> dict:
    """
    Fetch quote snapshots for a list of instruments.

    `instruments` must contain items like `NSE:INFY`, `NFO:NIFTY24APR24150CE`.
    """
    if not instruments:
        return {}
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    try:
        payload = kite.quote(instruments)
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        msg = str(exc).strip().replace("\n", " ")
        msg = msg[:240] if msg else "unknown error"
        raise ZerodhaQuoteError(f"Zerodha quote fetch failed ({msg})") from exc
    if not isinstance(payload, dict):
        raise ZerodhaQuoteError("Zerodha quote payload must be a dict")
    return payload


def fetch_holdings(*, api_key: str, access_token: str) -> list[dict]:
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    try:
        rows = kite.holdings()
    except Exception as exc:  # noqa: BLE001 - external SDK best-effort
        msg = str(exc).strip().replace("\n", " ")
        msg = msg[:240] if msg else "unknown error"
        raise ZerodhaHoldingsError(f"Zerodha holdings fetch failed ({msg})") from exc
    if not isinstance(rows, list):
        raise ZerodhaHoldingsError("Zerodha holdings payload must be a list")
    return [row for row in rows if isinstance(row, dict)]
