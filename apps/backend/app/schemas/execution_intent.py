from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.orders.types import OrderProduct, OrderSide, OrderType


class ExecutionIntentVersion(StrEnum):
    v1 = "1"


class ProductMode(StrEnum):
    delivery = "delivery"
    intraday = "intraday"
    carry_forward = "carry_forward"


class PriceAndPct(BaseModel):
    """
    Represents a level as both absolute price and signed percent relative to a
    reference.

    Percent is expressed in P&L terms:
    - BUY: +% means price above reference, -% below.
    - SELL: +% means price below reference (profit), -% above (loss).
    """

    price: float | None = Field(default=None, ge=0)
    pct: float | None = None


class TrailingStop(BaseModel):
    enabled: bool = False
    distance: PriceAndPct = Field(default_factory=PriceAndPct)


class ExecutionPlan(BaseModel):
    managed_exits: bool = False
    reference_price: float | None = Field(default=None, ge=0)
    reference_source: str | None = None
    stop_loss: PriceAndPct = Field(default_factory=PriceAndPct)
    target: PriceAndPct = Field(default_factory=PriceAndPct)
    trailing_sl: TrailingStop = Field(default_factory=TrailingStop)


class EntryIntent(BaseModel):
    broker: BrokerKey
    canonical_id: str = Field(min_length=3)
    side: OrderSide

    product_mode: ProductMode
    product: OrderProduct

    order_type: OrderType
    limit_price: float | None = Field(default=None, ge=0)

    # Normalized quantities (broker-facing quantity always required).
    quantity: int = Field(ge=1)
    lots: int | None = Field(default=None, ge=1)
    lot_size: int | None = Field(default=None, ge=1)


class ExecutionIntent(BaseModel):
    version: ExecutionIntentVersion = ExecutionIntentVersion.v1
    entry: EntryIntent
    plan: ExecutionPlan = Field(default_factory=ExecutionPlan)
    source_context: str | None = None
