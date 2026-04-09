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
