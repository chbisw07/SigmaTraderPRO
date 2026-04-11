from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class OrderSource(StrEnum):
    manual_ui = "manual_ui"
    tv_webhook = "tv_webhook"


class OrderIntentType(StrEnum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    SL = "SL"
    TARGET = "TARGET"
    TRAIL = "TRAIL"


class OrderTriggerMode(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    SL = "SL"
    SLM = "SLM"


class RiskMode(StrEnum):
    ABSOLUTE = "ABSOLUTE"
    POINTS = "POINTS"
    PERCENT = "PERCENT"


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderProduct(StrEnum):
    CNC = "CNC"
    MIS = "MIS"
    NRML = "NRML"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class OrderStatus(StrEnum):
    # Pre-dispatch / dispatch lifecycle (S4.3).
    BLOCKED = "BLOCKED"
    DISPATCH_FAILED = "DISPATCH_FAILED"
    ACKNOWLEDGED = "ACKNOWLEDGED"

    PENDING = "PENDING"
    OPEN = "OPEN"
    EXECUTED = "EXECUTED"
    PARTIAL = "PARTIAL"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"

    # Milestone placeholders for future protective semantics.
    SL_EXECUTED = "SL_EXECUTED"
    TARGET_EXECUTED = "TARGET_EXECUTED"


@dataclass(frozen=True, slots=True)
class BrokerEquityContract:
    exchange: str
    trading_symbol: str
    symbol_token: str | None = None


@dataclass(frozen=True, slots=True)
class EquityOrderRequest:
    contract: BrokerEquityContract
    side: OrderSide
    quantity: int
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = None


@dataclass(frozen=True, slots=True)
class EquityOrderResult:
    broker_order_id: str


@dataclass(frozen=True, slots=True)
class BrokerDerivativeContract:
    exchange: str
    trading_symbol: str
    symbol_token: str | None = None


@dataclass(frozen=True, slots=True)
class DerivativeOrderRequest:
    contract: BrokerDerivativeContract
    side: OrderSide
    quantity: int
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = None


@dataclass(frozen=True, slots=True)
class DerivativeOrderResult:
    broker_order_id: str


@dataclass(frozen=True, slots=True)
class ExternalBrokerOrder:
    """
    Normalized broker orderbook row for Orders workspace.

    Important: must not contain secrets/tokens. Broker-specific payloads remain
    internal.
    """

    broker: str
    broker_order_id: str | None
    exchange_order_id: str | None
    exchange: str | None
    trading_symbol: str | None
    broker_instrument_id: str | None

    placed_at: datetime | None

    side: str | None
    product: str | None
    order_type: str | None
    quantity: int | None
    price: float | None
    avg_price: float | None

    status: str | None
    rejection_reason: str | None


@dataclass(frozen=True, slots=True)
class ExternalBrokerPosition:
    """
    Normalized broker positionbook row for Positions workspace sync.

    Important: must not contain secrets/tokens. Broker-specific payloads remain
    internal.
    """

    broker: str
    broker_position_id: str | None
    exchange: str | None
    trading_symbol: str | None
    broker_instrument_id: str | None

    net_quantity: int
    avg_price: float | None
    last_price: float | None

    realized_pnl: float | None
    unrealized_pnl: float | None
    mtm: float | None


@dataclass(frozen=True, slots=True)
class BrokerQuoteRequest:
    """
    Safe, canonical-first quote request routed via a broker adapter.

    Important: must not include secrets/tokens.
    """

    canonical_id: str
    exchange: str
    trading_symbol: str | None = None
    broker_instrument_id: str | None = None


@dataclass(frozen=True, slots=True)
class ExternalBrokerQuote:
    """
    Normalized broker quote row for Watchlist/terminal display.

    Important: must not contain secrets/tokens. Broker payload remains internal.
    """

    broker: str
    canonical_id: str
    trading_symbol: str | None
    last_price: float | None
    previous_close: float | None
    change: float | None
    change_percent: float | None
    as_of: datetime | None
