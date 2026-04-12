from __future__ import annotations

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.schemas.instrument import InstrumentOut


class HoldingOut(BaseModel):
    row_id: str
    broker: BrokerKey

    canonical_id: str | None = None
    instrument: InstrumentOut | None = None
    symbol_display: str | None = None

    exchange: str | None = None
    isin: str | None = None

    quantity: int
    t1_quantity: int | None = None

    average_price: float | None = None
    last_price: float | None = None

    invested_value: float | None = None
    current_value: float | None = None

    pnl: float | None = None
    day_change: float | None = None
    day_change_percentage: float | None = None


class HoldingsMeta(BaseModel):
    broker_errors: dict[str, str] = Field(default_factory=dict)


class HoldingsListResponse(BaseModel):
    items: list[HoldingOut] = Field(default_factory=list)
    meta: HoldingsMeta = Field(default_factory=HoldingsMeta)
