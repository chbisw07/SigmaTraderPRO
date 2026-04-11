from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.orders.types import OrderSide, OrderSource
from app.schemas.instrument import InstrumentOut


class PositionOut(BaseModel):
    id: int
    opened_at: datetime
    updated_at: datetime

    broker: BrokerKey
    canonical_id: str
    instrument: InstrumentOut | None = None

    side: OrderSide
    quantity: int = Field(ge=0)
    lots: int | None = None

    avg_price: float | None = None
    last_price: float | None = None

    realized_pnl: float | None = None
    unrealized_pnl: float | None = None
    mtm: float | None = None

    linked_orders_count: int = 0
    source: OrderSource


class PositionListResponse(BaseModel):
    items: list[PositionOut]


class PositionActionRequest(BaseModel):
    # kept minimal; backend currently returns a draft to be placed via preview-first UI.
    mode: str | None = None
