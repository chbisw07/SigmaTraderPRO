from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class QuoteOut(BaseModel):
    canonical_id: str
    ltp: float | None = None
    change: float | None = None
    change_percent: float | None = None
    previous_close: float | None = None
    as_of: datetime | None = None


class QuotesResponse(BaseModel):
    broker: str
    items: list[QuoteOut]
    warning: str | None = None
