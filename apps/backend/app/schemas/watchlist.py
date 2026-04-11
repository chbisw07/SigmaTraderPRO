from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.instrument import InstrumentOut


class WatchlistOut(BaseModel):
    id: int
    name: str
    is_default: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WatchlistListResponse(BaseModel):
    items: list[WatchlistOut]


class WatchlistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    make_default: bool = False


class WatchlistUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_default: bool | None = None


class WatchlistItemOut(BaseModel):
    id: int
    position: int
    symbol_key: str
    canonical_id: str | None = None
    instrument: InstrumentOut | None = None
    display_symbol: str
    exchange: str | None = None
    segment: str | None = None
    instrument_type: str | None = None
    underlying: str | None = None
    expiry: date | None = None
    strike: float | None = None
    option_type: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WatchlistItemsResponse(BaseModel):
    watchlist: WatchlistOut
    items: list[WatchlistItemOut]


class WatchlistItemCreateRequest(BaseModel):
    # Canonical-first. If canonical_id is missing, treat as an underlying row.
    canonical_id: str | None = None
    underlying: str | None = None


class WatchlistReorderRequest(BaseModel):
    item_ids: list[int] = Field(min_length=1)
