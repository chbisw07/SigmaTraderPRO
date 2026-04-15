from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.angel_client import (
    AngelAuthError,
    AngelOrderBookError,
    AngelOrderError,
    AngelPositionBookError,
    AngelQuoteError,
    fetch_order_book,
    fetch_position_book,
    fetch_quotes,
    login_by_password,
    place_order,
)
from app.brokers.base import BrokerAdapter, BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey, BrokerSessionState, BrokerStatus
from app.core.config import settings
from app.core.crypto import CryptoError, decrypt_json, encrypt_json
from app.core.logger import get_logger, log_event
from app.core.time import IST, today_ist
from app.models.broker_connection import BrokerConnection
from app.models.user import User
from app.orders.types import (
    BrokerQuoteRequest,
    DerivativeOrderRequest,
    DerivativeOrderResult,
    EquityOrderRequest,
    EquityOrderResult,
    ExternalBrokerOrder,
    ExternalBrokerPosition,
    ExternalBrokerQuote,
    OrderProduct,
    OrderType,
)

logger = get_logger(__name__)

def _parse_order_timestamp(ts: object) -> datetime | None:
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts

    if isinstance(ts, (int, float)):
        v = float(ts)
        # Heuristic: treat 13+ digit epochs as milliseconds.
        if v > 1_000_000_000_000:
            v = v / 1000.0
        try:
            return datetime.fromtimestamp(v, tz=UTC)
        except Exception:
            return None

    s = str(ts).strip()
    if not s:
        return None

    if s.isdigit():
        try:
            v = float(s)
            if v > 1_000_000_000_000:
                v = v / 1000.0
            return datetime.fromtimestamp(v, tz=UTC)
        except Exception:
            return None

    # Common formats: "2026-04-10 09:15:00" or ISO.
    try:
        fixed = s.replace("Z", "+00:00")
        if " " in fixed and "T" not in fixed:
            fixed = fixed.replace(" ", "T", 1)
        dt = datetime.fromisoformat(fixed)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST).astimezone(UTC)
        return dt
    except Exception:
        pass

    # Broker SDKs sometimes return non-ISO formats.
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M",
        "%d %b %Y %H:%M:%S",
        "%d %b %Y %H:%M",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=IST).astimezone(UTC)
        except Exception:
            continue

    return None


def _get_connection(db: Session, user_id: int) -> BrokerConnection | None:
    return (
        db.query(BrokerConnection)
        .filter(BrokerConnection.user_id == user_id)
        .filter(BrokerConnection.broker_key == BrokerKey.angel.value)
        .one_or_none()
    )


def _get_or_create_connection(db: Session, user_id: int) -> BrokerConnection:
    existing = _get_connection(db, user_id)
    if existing:
        return existing
    conn = BrokerConnection(user_id=user_id, broker_key=BrokerKey.angel.value)
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


def _compute_status(conn: BrokerConnection | None) -> BrokerStatus:
    if not conn or not conn.credentials_enc:
        return BrokerStatus(
            broker=BrokerKey.angel,
            configured=False,
            enabled=False,
            state=BrokerSessionState.not_configured,
            connected=False,
            stale=False,
            session_day=None,
            last_connected_at=None,
            last_error=None,
        )

    enabled = bool(conn.is_enabled)
    configured = True
    session_day = conn.session_day
    last_connected_at = conn.last_connected_at
    last_error = conn.last_error

    if not enabled:
        return BrokerStatus(
            broker=BrokerKey.angel,
            configured=configured,
            enabled=False,
            state=BrokerSessionState.configured,
            connected=False,
            stale=False,
            session_day=session_day,
            last_connected_at=last_connected_at,
            last_error=last_error,
        )

    if not conn.session_enc or not session_day:
        state = BrokerSessionState.needs_reconnect
        if last_error:
            state = BrokerSessionState.error
        return BrokerStatus(
            broker=BrokerKey.angel,
            configured=configured,
            enabled=True,
            state=state,
            connected=False,
            stale=False,
            session_day=session_day,
            last_connected_at=last_connected_at,
            last_error=last_error,
        )

    if session_day != today_ist():
        return BrokerStatus(
            broker=BrokerKey.angel,
            configured=configured,
            enabled=True,
            state=BrokerSessionState.stale,
            connected=False,
            stale=True,
            session_day=session_day,
            last_connected_at=last_connected_at,
            last_error=last_error,
        )

    return BrokerStatus(
        broker=BrokerKey.angel,
        configured=configured,
        enabled=True,
        state=BrokerSessionState.connected,
        connected=True,
        stale=False,
        session_day=session_day,
        last_connected_at=last_connected_at,
        last_error=last_error,
    )


class AngelAdapter(BrokerAdapter):
    key = BrokerKey.angel
    display_name = "Angel One"

    def get_status(self, db: Session, user: User) -> BrokerStatus:
        conn = _get_connection(db, user.id)
        return _compute_status(conn)

    def upsert_settings(
        self, db: Session, user: User, *, payload: dict
    ) -> BrokerStatus:
        conn = _get_or_create_connection(db, user.id)
        conn.is_enabled = bool(payload.get("is_enabled", True))

        api_key = str(payload.get("api_key") or "").strip()
        client_code = str(payload.get("client_code") or "").strip()
        password = str(payload.get("password") or "")
        if not api_key or not client_code or not password:
            raise ValueError("api_key, client_code, and password are required")

        conn.credentials_enc = encrypt_json(
            {"api_key": api_key, "client_code": client_code, "password": password},
            key=settings.broker_encryption_key,
        )
        conn.last_error = None
        db.commit()
        db.refresh(conn)
        return _compute_status(conn)

    def connect(self, db: Session, user: User, *, payload: dict) -> BrokerStatus:
        conn = _get_or_create_connection(db, user.id)
        if not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        if not conn.is_enabled:
            raise BrokerNotConfiguredError("Broker is disabled")

        totp = str(payload.get("totp") or "").strip()
        if not totp:
            raise ValueError("totp is required")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            tokens = login_by_password(
                api_key=str(creds["api_key"]),
                client_code=str(creds["client_code"]),
                password=str(creds["password"]),
                totp=totp,
            )
        except (CryptoError, KeyError) as exc:
            raise BrokerNotConfiguredError("Broker credentials are invalid") from exc
        except AngelAuthError as exc:
            conn.last_error = str(exc)
            conn.session_enc = None
            conn.session_day = None
            db.commit()
            log_event(
                logger,
                "broker_connect_failed",
                category="broker",
                event_type="connect",
                broker=BrokerKey.angel.value,
                user_id=user.id,
                error=str(exc),
            )
            return _compute_status(conn)

        # Store session tokens encrypted (never logged).
        conn.session_enc = encrypt_json(
            {
                "jwt_token": tokens.jwt_token,
                "refresh_token": tokens.refresh_token,
                "feed_token": tokens.feed_token,
            },
            key=settings.broker_encryption_key,
        )
        conn.session_day = today_ist()
        conn.last_connected_at = datetime.now(tz=UTC)
        conn.last_error = None
        db.commit()
        db.refresh(conn)

        log_event(
            logger,
            "broker_connected",
            category="broker",
            event_type="connect",
            broker=BrokerKey.angel.value,
            user_id=user.id,
            session_day=str(conn.session_day),
        )

        return _compute_status(conn)

    def reconnect(self, db: Session, user: User, *, payload: dict) -> BrokerStatus:
        # Reconnect is the same connect flow for Angel (daily session validity model).
        return self.connect(db, user, payload=payload)

    def disconnect(self, db: Session, user: User) -> BrokerStatus:
        conn = _get_connection(db, user.id)
        if not conn:
            return _compute_status(None)
        conn.session_enc = None
        conn.session_day = None
        conn.last_error = None
        db.commit()
        db.refresh(conn)
        log_event(
            logger,
            "broker_disconnected",
            category="broker",
            event_type="disconnect",
            broker=BrokerKey.angel.value,
            user_id=user.id,
        )
        return _compute_status(conn)

    def place_equity_order(
        self, db: Session, user: User, *, request: EquityOrderRequest
    ) -> EquityOrderResult:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        status = _compute_status(conn)
        if not status.connected or status.stale:
            raise BrokerNotConfiguredError("Broker session is not connected")
        if not conn.session_enc:
            raise BrokerNotConfiguredError("Broker session is missing")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker session decrypt failed") from exc

        jwt_token = str(session.get("jwt_token") or "")
        if not jwt_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        if not request.contract.symbol_token:
            raise BrokerNotConfiguredError("Angel order requires symbol token mapping")

        product_type = "DELIVERY"
        if request.product == OrderProduct.MIS:
            product_type = "INTRADAY"

        order_type = "MARKET" if request.order_type == OrderType.MARKET else "LIMIT"

        try:
            broker_order_id = place_order(
                api_key=str(creds["api_key"]),
                jwt_token=jwt_token,
                exchange=request.contract.exchange,
                trading_symbol=request.contract.trading_symbol,
                symbol_token=str(request.contract.symbol_token),
                transaction_type=request.side.value,
                quantity=request.quantity,
                product_type=product_type,
                order_type=order_type,
                price=(
                    request.limit_price
                    if request.order_type == OrderType.LIMIT
                    else None
                ),
            )
        except (KeyError, AngelOrderError) as exc:
            conn.last_error = str(exc)
            db.commit()
            log_event(
                logger,
                "broker_order_failed",
                category="orders",
                event_type="place_order",
                broker=BrokerKey.angel.value,
                user_id=user.id,
                instrument_key="cash",
                status="failed",
                error=str(exc),
            )
            raise

        log_event(
            logger,
            "broker_order_placed",
            category="orders",
            event_type="place_order",
            broker=BrokerKey.angel.value,
            user_id=user.id,
            instrument_key="cash",
            status="ok",
            broker_order_id=broker_order_id,
        )
        return EquityOrderResult(broker_order_id=broker_order_id)

    def place_derivative_order(
        self, db: Session, user: User, *, request: DerivativeOrderRequest
    ) -> DerivativeOrderResult:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        status = _compute_status(conn)
        if not status.connected or status.stale:
            raise BrokerNotConfiguredError("Broker session is not connected")
        if not conn.session_enc:
            raise BrokerNotConfiguredError("Broker session is missing")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker session decrypt failed") from exc

        jwt_token = str(session.get("jwt_token") or "")
        if not jwt_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        if not request.contract.symbol_token:
            raise BrokerNotConfiguredError("Angel order requires symbol token mapping")

        product_type = "INTRADAY"
        if request.product == OrderProduct.NRML:
            product_type = "CARRYFORWARD"
        elif request.product == OrderProduct.MIS:
            product_type = "INTRADAY"
        else:
            raise BrokerNotConfiguredError("Invalid derivative product type")

        order_type = "MARKET" if request.order_type == OrderType.MARKET else "LIMIT"

        try:
            broker_order_id = place_order(
                api_key=str(creds["api_key"]),
                jwt_token=jwt_token,
                exchange=request.contract.exchange,
                trading_symbol=request.contract.trading_symbol,
                symbol_token=str(request.contract.symbol_token),
                transaction_type=request.side.value,
                quantity=request.quantity,
                product_type=product_type,
                order_type=order_type,
                price=(
                    request.limit_price
                    if request.order_type == OrderType.LIMIT
                    else None
                ),
            )
        except (KeyError, AngelOrderError) as exc:
            conn.last_error = str(exc)
            db.commit()
            log_event(
                logger,
                "broker_order_failed",
                category="orders",
                event_type="place_order",
                broker=BrokerKey.angel.value,
                user_id=user.id,
                instrument_key="fno",
                status="failed",
                error=str(exc),
            )
            raise

        log_event(
            logger,
            "broker_order_placed",
            category="orders",
            event_type="place_order",
            broker=BrokerKey.angel.value,
            user_id=user.id,
            instrument_key="fno",
            status="ok",
            broker_order_id=broker_order_id,
        )
        return DerivativeOrderResult(broker_order_id=broker_order_id)

    def fetch_recent_orders(self, db: Session, user: User) -> list[ExternalBrokerOrder]:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        status = _compute_status(conn)
        if not status.connected or status.stale:
            raise BrokerNotConfiguredError("Broker session is not connected")
        if not conn.session_enc:
            raise BrokerNotConfiguredError("Broker session is missing")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker session decrypt failed") from exc

        api_key = str(creds.get("api_key") or "")
        jwt_token = str(session.get("jwt_token") or "")
        if not api_key or not jwt_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        try:
            rows = fetch_order_book(api_key=api_key, jwt_token=jwt_token)
        except AngelOrderBookError as exc:
            raise BrokerError(str(exc)) from exc

        out: list[ExternalBrokerOrder] = []
        for row in rows:
            # Safe best-effort normalization; unknown fields remain None.
            broker_order_id = (
                row.get("orderid")
                or row.get("orderId")
                or row.get("uniqueorderid")
                or row.get("uniqueOrderId")
            )
            exchange_order_id = row.get("exchangeorderid") or row.get("exchangeOrderId")
            trading_symbol = row.get("tradingsymbol") or row.get("tradingSymbol")
            symbol_token = row.get("symboltoken") or row.get("symbolToken")
            exchange = row.get("exchange") or row.get("exch_seg")

            ts = (
                row.get("updatetime")
                or row.get("updateTime")
                or row.get("orderdatetime")
                or row.get("orderDateTime")
                or row.get("orderTime")
                or row.get("order_timestamp")
                or row.get("orderTimestamp")
                or row.get("exchtime")
                or row.get("exchTime")
                or row.get("exchange_timestamp")
                or row.get("exchangeTimestamp")
                or row.get("created_at")
                or row.get("createdAt")
            )
            placed_at = _parse_order_timestamp(ts)

            qty = None
            try:
                if row.get("quantity") is not None:
                    qty = int(row.get("quantity"))
            except Exception:
                qty = None

            price = None
            avg_price = None
            try:
                if row.get("price") is not None:
                    price = float(row.get("price"))
            except Exception:
                price = None
            try:
                if row.get("averageprice") is not None:
                    avg_price = float(row.get("averageprice"))
            except Exception:
                avg_price = None

            out.append(
                ExternalBrokerOrder(
                    broker=BrokerKey.angel.value,
                    broker_order_id=str(broker_order_id) if broker_order_id else None,
                    exchange_order_id=(
                        str(exchange_order_id) if exchange_order_id else None
                    ),
                    exchange=str(exchange) if exchange else None,
                    trading_symbol=str(trading_symbol) if trading_symbol else None,
                    broker_instrument_id=str(symbol_token) if symbol_token else None,
                    placed_at=placed_at,
                    side=str(
                        row.get("transactiontype") or row.get("transactionType") or ""
                    )
                    or None,
                    product=str(row.get("producttype") or row.get("productType") or "")
                    or None,
                    order_type=str(row.get("ordertype") or row.get("orderType") or "")
                    or None,
                    quantity=qty,
                    price=price,
                    avg_price=avg_price,
                    status=str(row.get("orderstatus") or row.get("orderStatus") or "")
                    or None,
                    rejection_reason=str(row.get("text") or row.get("message") or "")
                    or None,
                )
            )
        return out

    def fetch_positions(self, db: Session, user: User) -> list[ExternalBrokerPosition]:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        status = _compute_status(conn)
        if not status.connected or status.stale:
            raise BrokerNotConfiguredError("Broker session is not connected")
        if not conn.session_enc:
            raise BrokerNotConfiguredError("Broker session is missing")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker session decrypt failed") from exc

        api_key = str(creds.get("api_key") or "")
        jwt_token = str(session.get("jwt_token") or "")
        if not api_key or not jwt_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        try:
            rows = fetch_position_book(api_key=api_key, jwt_token=jwt_token)
        except AngelPositionBookError as exc:
            raise BrokerError(str(exc)) from exc

        out: list[ExternalBrokerPosition] = []
        for row in rows:
            trading_symbol = row.get("tradingsymbol") or row.get("tradingSymbol")
            symbol_token = row.get("symboltoken") or row.get("symbolToken")
            exchange = row.get("exchange") or row.get("exch_seg")
            broker_position_id = row.get("positionid") or row.get("positionId")

            net_qty = 0
            try:
                if row.get("netqty") is not None:
                    net_qty = int(row.get("netqty"))
                elif row.get("netQty") is not None:
                    net_qty = int(row.get("netQty"))
            except Exception:
                net_qty = 0

            avg_price = None
            last_price = None
            realized = None
            unrealized = None
            mtm = None

            try:
                if row.get("avgnetprice") is not None:
                    avg_price = float(row.get("avgnetprice"))
                elif row.get("avgPrice") is not None:
                    avg_price = float(row.get("avgPrice"))
            except Exception:
                avg_price = None
            try:
                if row.get("ltp") is not None:
                    last_price = float(row.get("ltp"))
                elif row.get("last_price") is not None:
                    last_price = float(row.get("last_price"))
            except Exception:
                last_price = None
            try:
                if row.get("realised") is not None:
                    realized = float(row.get("realised"))
                elif row.get("realized") is not None:
                    realized = float(row.get("realized"))
            except Exception:
                realized = None
            try:
                if row.get("unrealised") is not None:
                    unrealized = float(row.get("unrealised"))
                elif row.get("unrealized") is not None:
                    unrealized = float(row.get("unrealized"))
            except Exception:
                unrealized = None
            try:
                if row.get("mtm") is not None:
                    mtm = float(row.get("mtm"))
                elif row.get("pnl") is not None:
                    mtm = float(row.get("pnl"))
            except Exception:
                mtm = None

            out.append(
                ExternalBrokerPosition(
                    broker=BrokerKey.angel.value,
                    broker_position_id=(
                        str(broker_position_id) if broker_position_id else None
                    ),
                    exchange=str(exchange) if exchange else None,
                    trading_symbol=str(trading_symbol) if trading_symbol else None,
                    broker_instrument_id=str(symbol_token) if symbol_token else None,
                    net_quantity=net_qty,
                    avg_price=avg_price,
                    last_price=last_price,
                    realized_pnl=realized,
                    unrealized_pnl=unrealized,
                    mtm=mtm,
                )
            )
        return out

    def fetch_quotes(
        self, db: Session, user: User, *, requests: list[BrokerQuoteRequest]
    ) -> list[ExternalBrokerQuote]:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        status = _compute_status(conn)
        if not status.connected or status.stale:
            raise BrokerNotConfiguredError("Broker session is not connected")
        if not conn.session_enc:
            raise BrokerNotConfiguredError("Broker session is missing")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker session decrypt failed") from exc

        api_key = str(creds.get("api_key") or "")
        jwt_token = str(session.get("jwt_token") or "")
        if not api_key or not jwt_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        exchange_tokens: dict[str, list[str]] = {}
        # Preserve insertion order to help stable UI rendering.
        ordered: list[BrokerQuoteRequest] = []
        for req in requests:
            token = str(req.broker_instrument_id or "").strip()
            exch = str(req.exchange or "").strip().upper()
            if not token or not exch:
                continue
            exchange_tokens.setdefault(exch, []).append(token)
            ordered.append(req)

        now = datetime.now(tz=UTC)
        if not exchange_tokens:
            return [
                ExternalBrokerQuote(
                    broker=BrokerKey.angel.value,
                    canonical_id=req.canonical_id,
                    trading_symbol=req.trading_symbol,
                    last_price=None,
                    previous_close=None,
                    change=None,
                    change_percent=None,
                    as_of=now,
                )
                for req in requests
            ]

        try:
            rows = fetch_quotes(
                api_key=api_key,
                jwt_token=jwt_token,
                exchange_tokens=exchange_tokens,
                mode="FULL",
            )
        except AngelQuoteError as exc:
            raise BrokerError(str(exc)) from exc
        except Exception:  # noqa: BLE001
            raise BrokerError("Angel quote fetch failed") from None

        by_token: dict[str, dict] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            token = row.get("symbolToken") or row.get("symboltoken") or row.get("token")
            if token:
                by_token[str(token)] = row

        out: list[ExternalBrokerQuote] = []
        for req in ordered:
            token = str(req.broker_instrument_id or "").strip()
            row = by_token.get(token)
            last_price = None
            prev_close = None
            change = None
            change_pct = None
            if isinstance(row, dict):
                try:
                    if row.get("ltp") is not None:
                        last_price = float(row.get("ltp"))
                    elif row.get("last_price") is not None:
                        last_price = float(row.get("last_price"))
                except Exception:
                    last_price = None
                try:
                    if row.get("close") is not None:
                        prev_close = float(row.get("close"))
                    elif row.get("previousClose") is not None:
                        prev_close = float(row.get("previousClose"))
                except Exception:
                    prev_close = None
                try:
                    if row.get("netChange") is not None:
                        change = float(row.get("netChange"))
                    elif row.get("netchange") is not None:
                        change = float(row.get("netchange"))
                except Exception:
                    change = None
                try:
                    if row.get("percentChange") is not None:
                        change_pct = float(row.get("percentChange"))
                    elif row.get("perChange") is not None:
                        change_pct = float(row.get("perChange"))
                except Exception:
                    change_pct = None
                if change is None and last_price is not None and prev_close:
                    change = last_price - prev_close
                if change_pct is None and change is not None and prev_close:
                    try:
                        change_pct = (change / prev_close) * 100
                    except Exception:
                        change_pct = None

            out.append(
                ExternalBrokerQuote(
                    broker=BrokerKey.angel.value,
                    canonical_id=req.canonical_id,
                    trading_symbol=req.trading_symbol,
                    last_price=last_price,
                    previous_close=prev_close,
                    change=change,
                    change_percent=change_pct,
                    as_of=now,
                )
            )
        return out
