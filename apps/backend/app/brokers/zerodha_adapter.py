from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.base import BrokerAdapter, BrokerNotConfiguredError
from app.brokers.types import BrokerKey, BrokerSessionState, BrokerStatus
from app.brokers.zerodha_client import (
    ZerodhaAuthError,
    exchange_request_token,
    get_login_url,
)
from app.core.config import settings
from app.core.crypto import CryptoError, decrypt_json, encrypt_json
from app.core.logger import get_logger, log_event
from app.core.time import today_ist
from app.models.broker_connection import BrokerConnection
from app.models.user import User

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
