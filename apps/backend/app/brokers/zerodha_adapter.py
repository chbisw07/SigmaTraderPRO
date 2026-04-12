from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.base import BrokerAdapter, BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey, BrokerSessionState, BrokerStatus
from app.brokers.zerodha_client import (
    ZerodhaAuthError,
    ZerodhaHoldingsError,
    ZerodhaOrderBookError,
    ZerodhaOrderError,
    ZerodhaPositionBookError,
    ZerodhaQuoteError,
    exchange_request_token,
    fetch_holdings,
    fetch_orders,
    fetch_positions,
    fetch_quotes,
    get_login_url,
    place_order,
)
from app.core.config import settings
from app.core.crypto import CryptoError, decrypt_json, encrypt_json
from app.core.logger import get_logger, log_event
from app.core.time import today_ist
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


def _get_connection(db: Session, user_id: int) -> BrokerConnection | None:
    return (
        db.query(BrokerConnection)
        .filter(BrokerConnection.user_id == user_id)
        .filter(BrokerConnection.broker_key == BrokerKey.zerodha.value)
        .one_or_none()
    )


def _get_or_create_connection(db: Session, user_id: int) -> BrokerConnection:
    existing = _get_connection(db, user_id)
    if existing:
        return existing
    conn = BrokerConnection(user_id=user_id, broker_key=BrokerKey.zerodha.value)
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


def _compute_status(conn: BrokerConnection | None) -> BrokerStatus:
    if not conn or not conn.credentials_enc:
        return BrokerStatus(
            broker=BrokerKey.zerodha,
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
    session_day = conn.session_day

    if not enabled:
        return BrokerStatus(
            broker=BrokerKey.zerodha,
            configured=True,
            enabled=False,
            state=BrokerSessionState.configured,
            connected=False,
            stale=False,
            session_day=session_day,
            last_connected_at=conn.last_connected_at,
            last_error=conn.last_error,
        )

    if not conn.session_enc or not session_day:
        state = BrokerSessionState.needs_reconnect
        if conn.last_error:
            state = BrokerSessionState.error
        return BrokerStatus(
            broker=BrokerKey.zerodha,
            configured=True,
            enabled=True,
            state=state,
            connected=False,
            stale=False,
            session_day=session_day,
            last_connected_at=conn.last_connected_at,
            last_error=conn.last_error,
        )

    if session_day != today_ist():
        return BrokerStatus(
            broker=BrokerKey.zerodha,
            configured=True,
            enabled=True,
            state=BrokerSessionState.stale,
            connected=False,
            stale=True,
            session_day=session_day,
            last_connected_at=conn.last_connected_at,
            last_error=conn.last_error,
        )

    return BrokerStatus(
        broker=BrokerKey.zerodha,
        configured=True,
        enabled=True,
        state=BrokerSessionState.connected,
        connected=True,
        stale=False,
        session_day=session_day,
        last_connected_at=conn.last_connected_at,
        last_error=conn.last_error,
    )


class ZerodhaAdapter(BrokerAdapter):
    key = BrokerKey.zerodha
    display_name = "Zerodha"

    def get_status(self, db: Session, user: User) -> BrokerStatus:
        return _compute_status(_get_connection(db, user.id))

    def upsert_settings(
        self, db: Session, user: User, *, payload: dict
    ) -> BrokerStatus:
        conn = _get_or_create_connection(db, user.id)
        conn.is_enabled = bool(payload.get("is_enabled", True))

        api_key = str(payload.get("api_key") or "").strip()
        api_secret = str(payload.get("api_secret") or "").strip()
        if not api_key or not api_secret:
            raise ValueError("api_key and api_secret are required")

        conn.credentials_enc = encrypt_json(
            {"api_key": api_key, "api_secret": api_secret},
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

        request_token = str(payload.get("request_token") or "").strip()
        if not request_token:
            raise ValueError("request_token is required")

        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
            session = exchange_request_token(
                api_key=str(creds["api_key"]),
                api_secret=str(creds["api_secret"]),
                request_token=request_token,
            )
        except (CryptoError, KeyError) as exc:
            raise BrokerNotConfiguredError("Broker credentials are invalid") from exc
        except ZerodhaAuthError as exc:
            conn.last_error = str(exc)
            conn.session_enc = None
            conn.session_day = None
            db.commit()
            log_event(
                logger,
                "broker_connect_failed",
                category="broker",
                event_type="connect",
                broker=BrokerKey.zerodha.value,
                user_id=user.id,
                error=str(exc),
            )
            return _compute_status(conn)

        conn.session_enc = encrypt_json(
            {
                "access_token": session.access_token,
                "public_token": session.public_token,
                "user_id": session.user_id,
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
            broker=BrokerKey.zerodha.value,
            user_id=user.id,
            session_day=str(conn.session_day),
        )

        return _compute_status(conn)

    def reconnect(self, db: Session, user: User, *, payload: dict) -> BrokerStatus:
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
            broker=BrokerKey.zerodha.value,
            user_id=user.id,
        )
        return _compute_status(conn)

    def get_login_url(self, db: Session, user: User) -> str:
        conn = _get_connection(db, user.id)
        if not conn or not conn.credentials_enc:
            raise BrokerNotConfiguredError("Broker is not configured")
        try:
            creds = decrypt_json(
                conn.credentials_enc, key=settings.broker_encryption_key
            )
        except CryptoError as exc:
            raise BrokerNotConfiguredError("Broker credentials are invalid") from exc
        return get_login_url(api_key=str(creds["api_key"]))

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

        product = request.product.value
        if request.product == OrderProduct.CNC:
            product = "CNC"
        elif request.product == OrderProduct.MIS:
            product = "MIS"

        order_type = request.order_type.value
        if request.order_type == OrderType.MARKET:
            order_type = "MARKET"
        elif request.order_type == OrderType.LIMIT:
            order_type = "LIMIT"

        try:
            broker_order_id = place_order(
                api_key=str(creds["api_key"]),
                access_token=str(session["access_token"]),
                exchange=request.contract.exchange,
                trading_symbol=request.contract.trading_symbol,
                transaction_type=request.side.value,
                quantity=request.quantity,
                product=product,
                order_type=order_type,
                price=(
                    request.limit_price
                    if request.order_type == OrderType.LIMIT
                    else None
                ),
            )
        except (KeyError, ZerodhaOrderError) as exc:
            conn.last_error = str(exc)
            db.commit()
            log_event(
                logger,
                "broker_order_failed",
                category="orders",
                event_type="place_order",
                broker=BrokerKey.zerodha.value,
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
            broker=BrokerKey.zerodha.value,
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

        product = request.product.value
        if request.product == OrderProduct.MIS:
            product = "MIS"
        elif request.product == OrderProduct.NRML:
            product = "NRML"
        else:
            raise BrokerNotConfiguredError("Invalid derivative product type")

        order_type = request.order_type.value
        if request.order_type == OrderType.MARKET:
            order_type = "MARKET"
        elif request.order_type == OrderType.LIMIT:
            order_type = "LIMIT"

        try:
            broker_order_id = place_order(
                api_key=str(creds["api_key"]),
                access_token=str(session["access_token"]),
                exchange=request.contract.exchange,
                trading_symbol=request.contract.trading_symbol,
                transaction_type=request.side.value,
                quantity=request.quantity,
                product=product,
                order_type=order_type,
                price=(
                    request.limit_price
                    if request.order_type == OrderType.LIMIT
                    else None
                ),
            )
        except (KeyError, ZerodhaOrderError) as exc:
            conn.last_error = str(exc)
            db.commit()
            log_event(
                logger,
                "broker_order_failed",
                category="orders",
                event_type="place_order",
                broker=BrokerKey.zerodha.value,
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
            broker=BrokerKey.zerodha.value,
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
        access_token = str(session.get("access_token") or "")
        if not api_key or not access_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        try:
            rows = fetch_orders(api_key=api_key, access_token=access_token)
        except ZerodhaOrderBookError as exc:
            raise BrokerError(str(exc)) from exc

        out: list[ExternalBrokerOrder] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            broker_order_id = row.get("order_id") or row.get("orderId")
            exchange_order_id = row.get("exchange_order_id") or row.get(
                "exchangeOrderId"
            )
            exchange = row.get("exchange")
            trading_symbol = row.get("tradingsymbol") or row.get("trading_symbol")
            instrument_token = row.get("instrument_token")

            placed_at = None
            ts = (
                row.get("order_timestamp")
                or row.get("exchange_timestamp")
                or row.get("created_at")
            )
            if ts:
                try:
                    s = str(ts).strip().replace("Z", "+00:00")
                    # Some SDKs return "YYYY-MM-DD HH:MM:SS"
                    if " " in s and "T" not in s:
                        s = s.replace(" ", "T", 1)
                    placed_at = datetime.fromisoformat(s)
                except Exception:
                    placed_at = None

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
                if row.get("average_price") is not None:
                    avg_price = float(row.get("average_price"))
            except Exception:
                avg_price = None

            out.append(
                ExternalBrokerOrder(
                    broker=BrokerKey.zerodha.value,
                    broker_order_id=str(broker_order_id) if broker_order_id else None,
                    exchange_order_id=(
                        str(exchange_order_id) if exchange_order_id else None
                    ),
                    exchange=str(exchange) if exchange else None,
                    trading_symbol=str(trading_symbol) if trading_symbol else None,
                    broker_instrument_id=(
                        str(instrument_token) if instrument_token is not None else None
                    ),
                    placed_at=placed_at,
                    side=str(
                        row.get("transaction_type") or row.get("transactionType") or ""
                    )
                    or None,
                    product=str(row.get("product") or "") or None,
                    order_type=str(row.get("order_type") or row.get("orderType") or "")
                    or None,
                    quantity=qty,
                    price=price,
                    avg_price=avg_price,
                    status=str(row.get("status") or "") or None,
                    rejection_reason=str(
                        row.get("status_message") or row.get("message") or ""
                    )
                    or None,
                )
            )
        return out

    def fetch_holdings(self, db: Session, user: User) -> list[dict]:
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
        access_token = str(session.get("access_token") or "")
        if not api_key or not access_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        try:
            return fetch_holdings(api_key=api_key, access_token=access_token)
        except ZerodhaHoldingsError as exc:
            raise BrokerError(str(exc)) from exc

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
        access_token = str(session.get("access_token") or "")
        if not api_key or not access_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        try:
            rows = fetch_positions(api_key=api_key, access_token=access_token)
        except ZerodhaPositionBookError as exc:
            raise BrokerError(str(exc)) from exc

        out: list[ExternalBrokerPosition] = []
        for row in rows:
            trading_symbol = row.get("tradingsymbol") or row.get("trading_symbol")
            exchange = row.get("exchange")
            instrument_token = row.get("instrument_token")
            broker_position_id = row.get("position_id") or row.get("positionId")

            net_qty = 0
            try:
                if row.get("quantity") is not None:
                    net_qty = int(row.get("quantity"))
            except Exception:
                net_qty = 0

            avg_price = None
            last_price = None
            realized = None
            unrealized = None
            mtm = None
            try:
                if row.get("average_price") is not None:
                    avg_price = float(row.get("average_price"))
            except Exception:
                avg_price = None
            try:
                if row.get("last_price") is not None:
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
                if row.get("pnl") is not None:
                    mtm = float(row.get("pnl"))
                elif row.get("mtm") is not None:
                    mtm = float(row.get("mtm"))
            except Exception:
                mtm = None

            out.append(
                ExternalBrokerPosition(
                    broker=BrokerKey.zerodha.value,
                    broker_position_id=(
                        str(broker_position_id) if broker_position_id else None
                    ),
                    exchange=str(exchange) if exchange else None,
                    trading_symbol=str(trading_symbol) if trading_symbol else None,
                    broker_instrument_id=(
                        str(instrument_token) if instrument_token is not None else None
                    ),
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
        access_token = str(session.get("access_token") or "")
        if not api_key or not access_token:
            raise BrokerNotConfiguredError("Broker session token missing")

        def _instrument_str(req: BrokerQuoteRequest) -> str | None:
            exchange = str(req.exchange or "").strip().upper()
            sym = str(req.trading_symbol or "").strip().upper()
            if not exchange or not sym:
                return None
            return f"{exchange}:{sym}"

        instrument_strings: list[str] = []
        by_str: dict[str, BrokerQuoteRequest] = {}
        for req in requests:
            s = _instrument_str(req)
            if not s:
                continue
            instrument_strings.append(s)
            by_str[s] = req

        now = datetime.now(tz=UTC)
        if not instrument_strings:
            return [
                ExternalBrokerQuote(
                    broker=BrokerKey.zerodha.value,
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
            payload = fetch_quotes(
                api_key=api_key,
                access_token=access_token,
                instruments=instrument_strings,
            )
        except ZerodhaQuoteError as exc:
            raise BrokerError(str(exc)) from exc

        out: list[ExternalBrokerQuote] = []
        for s in instrument_strings:
            req = by_str.get(s)
            if not req:
                continue
            row = payload.get(s) if isinstance(payload, dict) else None
            last_price = None
            prev_close = None
            change = None
            change_pct = None
            if isinstance(row, dict):
                try:
                    if row.get("last_price") is not None:
                        last_price = float(row.get("last_price"))
                except Exception:
                    last_price = None
                ohlc = row.get("ohlc") if isinstance(row.get("ohlc"), dict) else {}
                try:
                    if ohlc and ohlc.get("close") is not None:
                        prev_close = float(ohlc.get("close"))
                except Exception:
                    prev_close = None
                try:
                    if row.get("net_change") is not None:
                        change = float(row.get("net_change"))
                except Exception:
                    change = None
                if change is None and last_price is not None and prev_close:
                    change = last_price - prev_close
                if change is not None and prev_close:
                    try:
                        change_pct = (change / prev_close) * 100
                    except Exception:
                        change_pct = None

            out.append(
                ExternalBrokerQuote(
                    broker=BrokerKey.zerodha.value,
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
