from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.orders.types import (
    OrderIntentType,
    OrderProduct,
    OrderSide,
    OrderSource,
    OrderStatus,
    OrderType,
)
from app.schemas.instrument import InstrumentOut


class OrdersSourceMode(StrEnum):
    merged = "merged"
    internal_only = "internal_only"
    broker_only = "broker_only"


class OrdersSourceOrigin(StrEnum):
    sigmatrader = "sigmatrader"
    broker_external = "broker_external"
    merged = "merged"


class OrdersReconciliationState(StrEnum):
    internal_only = "internal_only"
    broker_only = "broker_only"
    matched = "matched"
    unresolved = "unresolved"


class OrdersWorkspaceRow(BaseModel):
    row_id: str
    source_origin: OrdersSourceOrigin
    reconciliation_state: OrdersReconciliationState

    broker: BrokerKey

    internal_order_id: int | None = None
    broker_order_id: str | None = None
    exchange_order_id: str | None = None

    canonical_id: str | None = None
    instrument: InstrumentOut | None = None
    symbol_display: str | None = None

    side: OrderSide | None = None
    product: OrderProduct | None = None
    quantity: int | None = None
    lots: int | None = None
    order_type: OrderType | None = None
    placed_price: float | None = None
    avg_price: float | None = None

    status: OrderStatus | None = None
    rejection_reason: str | None = None

    placed_at: datetime | None = None

    # SigmaTraderPRO internal metadata (present for internal/merged).
    source: OrderSource | None = None
    intent_type: OrderIntentType | None = None
    linked_position_id: int | None = None


class OrdersWorkspaceMeta(BaseModel):
    include_broker_orders: bool
    mode: OrdersSourceMode
    broker_errors: dict[str, str] = Field(default_factory=dict)


class OrdersWorkspaceResponse(BaseModel):
    items: list[OrdersWorkspaceRow]
    meta: OrdersWorkspaceMeta
