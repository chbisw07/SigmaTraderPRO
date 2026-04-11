from __future__ import annotations

from pydantic import BaseModel, Field


class SystemEventOut(BaseModel):
    id: int
    created_at: str
    level: str
    category: str
    message: str
    correlation_id: str | None = None
    broker: str | None = None
    symbol: str | None = None
    metadata: dict | None = None


class SystemEventsListResponse(BaseModel):
    items: list[SystemEventOut] = Field(default_factory=list)


class SystemEventsCleanupResponse(BaseModel):
    status: str = "ok"
    deleted: int
