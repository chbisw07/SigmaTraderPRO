from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.brokers.types import BrokerKey, BrokerSessionState
from app.core.config import settings
from app.models.user import User
from app.services.broker_service import broker_service


class DispatchReasonCode:
    DISPATCH_DISABLED = "DISPATCH_DISABLED"
    BROKER_OFFLINE = "BROKER_OFFLINE"
    BROKER_NOT_CONNECTED = "BROKER_NOT_CONNECTED"
    BROKER_SESSION_MISSING = "BROKER_SESSION_MISSING"
    BROKER_SESSION_STALE = "BROKER_SESSION_STALE"
    BROKER_DISPATCH_ERROR = "BROKER_DISPATCH_ERROR"
    BROKER_REJECTED = "BROKER_REJECTED"
    UNKNOWN_DISPATCH_FAILURE = "UNKNOWN_DISPATCH_FAILURE"


@dataclass(frozen=True, slots=True)
class DispatchGateResult:
    allowed: bool
    reason_code: str | None
    reason_message: str | None
    diagnostics: dict[str, Any]
    correlation_id: str


def _now_utc_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


class DispatchGatingService:
    """
    Centralized pre-dispatch safety gates for manual orders.

    IMPORTANT: Do not add speculative probes here (e.g., "ping broker") unless the
    codebase has a proven readiness signal. Prefer deterministic local state:
    broker connection record + session validity model.
    """

    def evaluate(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey,
        correlation_id: str,
    ) -> DispatchGateResult:
        diagnostics: dict[str, Any] = {
            "ts": _now_utc_iso(),
            "broker": broker.value,
        }

        # Gate 0: global dispatch enable (operator kill-switch).
        if not bool(getattr(settings, "orders_dispatch_enabled", True)):
            return DispatchGateResult(
                allowed=False,
                reason_code=DispatchReasonCode.DISPATCH_DISABLED,
                reason_message="Order dispatch is disabled by configuration.",
                diagnostics=diagnostics | {"orders_dispatch_enabled": False},
                correlation_id=correlation_id,
            )

        status = broker_service.status(db, user, broker=broker)
        diagnostics |= {
            "broker_status": {
                "configured": bool(status.configured),
                "enabled": bool(status.enabled),
                "state": status.state.value,
                "connected": bool(status.connected),
                "stale": bool(status.stale),
                "session_day": str(status.session_day) if status.session_day else None,
                "last_connected_at": (
                    status.last_connected_at.astimezone(UTC).isoformat()
                    if status.last_connected_at
                    else None
                ),
                "last_error": status.last_error,
            }
        }

        # Gate 1: broker configured/enabled
        if not status.configured:
            return DispatchGateResult(
                allowed=False,
                reason_code=DispatchReasonCode.BROKER_SESSION_MISSING,
                reason_message="Order blocked: broker is not configured.",
                diagnostics=diagnostics,
                correlation_id=correlation_id,
            )
        if not status.enabled:
            return DispatchGateResult(
                allowed=False,
                reason_code=DispatchReasonCode.DISPATCH_DISABLED,
                reason_message="Order blocked: broker is disabled.",
                diagnostics=diagnostics,
                correlation_id=correlation_id,
            )

        # Gate 2: stale session
        if status.stale or status.state == BrokerSessionState.stale:
            return DispatchGateResult(
                allowed=False,
                reason_code=DispatchReasonCode.BROKER_SESSION_STALE,
                reason_message=(
                    "Order blocked: broker session is stale. "
                    "Reconnect broker and try again."
                ),
                diagnostics=diagnostics,
                correlation_id=correlation_id,
            )

        # Gate 3: missing/unusable session
        if not status.connected:
            if status.state in {
                BrokerSessionState.needs_reconnect,
                BrokerSessionState.error,
            }:
                msg = (
                    "Order blocked: broker session is missing or invalid. "
                    "Reconnect broker and try again."
                )
                if status.last_error:
                    msg = f"{msg} ({status.last_error})"
                return DispatchGateResult(
                    allowed=False,
                    reason_code=DispatchReasonCode.BROKER_SESSION_MISSING,
                    reason_message=msg,
                    diagnostics=diagnostics,
                    correlation_id=correlation_id,
                )
            return DispatchGateResult(
                allowed=False,
                reason_code=DispatchReasonCode.BROKER_NOT_CONNECTED,
                reason_message="Order blocked: broker is not connected.",
                diagnostics=diagnostics,
                correlation_id=correlation_id,
            )

        return DispatchGateResult(
            allowed=True,
            reason_code=None,
            reason_message=None,
            diagnostics=diagnostics | {"allowed": True},
            correlation_id=correlation_id,
        )


dispatch_gating_service = DispatchGatingService()
