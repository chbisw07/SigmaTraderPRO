from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

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


class DerivativeExpiriesResponse(BaseModel):
    underlying: str
    exchange: Exchange
    instrument_type: InstrumentType
    expiries: list[date]


class DerivativeStrikesResponse(BaseModel):
    underlying: str
    exchange: Exchange
    expiry: date
    option_type: OptionType | None = None
    strikes: list[float]


class InstrumentSyncRequest(BaseModel):
    scope: Literal["equity", "fno_underlyings"] = "equity"
    underlyings: list[str] = Field(default_factory=list)
    max_rows: int | None = Field(default=None, ge=1, le=1_000_000)


class InstrumentSyncResponse(BaseModel):
    source: str
    scope: str
    processed: int
    ingested: int
    skipped: int
