from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.angel_client import (
    AngelAuthError,
    AngelOrderError,
    login_by_password,
    place_order,
)
from app.brokers.base import BrokerAdapter, BrokerNotConfiguredError
from app.brokers.types import BrokerKey, BrokerSessionState, BrokerStatus
from app.core.config import settings
from app.core.crypto import CryptoError, decrypt_json, encrypt_json
from app.core.logger import get_logger, log_event
from app.core.time import today_ist
from app.models.broker_connection import BrokerConnection
from app.models.user import User
from app.orders.types import (
    EquityOrderRequest,
    EquityOrderResult,
    OrderProduct,
    OrderType,
)

logger = get_logger(__name__)


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
