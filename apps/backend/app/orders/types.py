from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderProduct(StrEnum):
    CNC = "CNC"
    MIS = "MIS"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class OrderStatus(StrEnum):
    CREATED = "created"
    PREVIEWED = "previewed"
    SUBMITTED = "submitted"
    FAILED = "failed"


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
