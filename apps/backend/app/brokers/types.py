from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum


class BrokerKey(StrEnum):
    angel = "angel"
    zerodha = "zerodha"


class BrokerSessionState(StrEnum):
    not_configured = "not_configured"
    configured = "configured"
    connected = "connected"
    stale = "stale"
    needs_reconnect = "needs_reconnect"
    error = "error"


@dataclass(frozen=True, slots=True)
class BrokerStatus:
    broker: BrokerKey
    configured: bool
    enabled: bool
    state: BrokerSessionState
    connected: bool
    stale: bool
    session_day: date | None
    last_connected_at: datetime | None
    last_error: str | None
