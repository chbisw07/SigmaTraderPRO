from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from app.instruments.types import Exchange, InstrumentType, OptionType, Segment


class InstrumentOut(BaseModel):
    canonical_id: str
    exchange: Exchange
    segment: Segment
    instrument_type: InstrumentType
    symbol_root: str
    display_symbol: str
    underlying: str | None = None
    expiry: date | None = None
    strike: float | None = None
    option_type: OptionType | None = None
    lot_size: int | None = None
    tick_size: float | None = None
    isin: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class InstrumentSearchResponse(BaseModel):
    items: list[InstrumentOut]
