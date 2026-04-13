from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.orders.types import OrderSide
from app.schemas.instrument import InstrumentOut


class QueueSourceType(StrEnum):
    manual_ui = "manual_ui"
    tradingview = "tradingview"
    alert = "alert"
    system = "system"
    ai = "ai"


class QueueExecutionMode(StrEnum):
    manual_review = "manual_review"
    auto_dispatch = "auto_dispatch"


class QueueStatus(StrEnum):
    queued = "queued"
    ready = "ready"
    blocked = "blocked"
    approved = "approved"
    dispatched = "dispatched"
    cancelled = "cancelled"
    failed = "failed"
    expired = "expired"


class QueueValidationState(StrEnum):
    valid = "valid"
    warning = "warning"
    blocked = "blocked"


class IngestionQueueCreateRequest(BaseModel):
    source_type: QueueSourceType = QueueSourceType.manual_ui
    source_ref: str | None = None
    correlation_id: str | None = None
    idempotency_key: str | None = None
    execution_mode: QueueExecutionMode = QueueExecutionMode.manual_review
    execution_intent: dict
    notes: str | None = None
    expires_at: datetime | None = None


class IngestionQueueUpdateRequest(BaseModel):
    execution_mode: QueueExecutionMode | None = None
    execution_intent: dict | None = None
    notes: str | None = None
    expires_at: datetime | None = None


class IngestionQueueResolveRequest(BaseModel):
    broker: str | None = Field(default=None, max_length=50)
    canonical_id: str | None = Field(default=None, max_length=255)
    product: str | None = Field(default=None, max_length=16)
    order_type: str | None = Field(default=None, max_length=16)
    quantity: int | None = Field(default=None, ge=1)
    limit_price: float | None = Field(default=None, ge=0)
    instrument_hint: dict | None = None


class IngestionQueueItemOut(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime

    source_type: QueueSourceType
    source_ref: str | None = None

    correlation_id: str
    idempotency_key: str

    broker: str
    canonical_id: str
    instrument: InstrumentOut | None = None

    side: OrderSide | None = None
    quantity: int | None = Field(default=None, ge=1)
    lots: int | None = Field(default=None, ge=1)
    product: str | None = None
    order_type: str | None = None
    limit_price: float | None = Field(default=None, ge=0)
    managed_exits: bool = False

    execution_mode: QueueExecutionMode
    status: QueueStatus
    validation_state: QueueValidationState
    block_reason_code: str | None = None
    block_reason_message: str | None = None
    resolution_state: str = "resolved"
    resolution: dict = Field(default_factory=dict)

    dispatched_order_id: int | None = None
    notes: str | None = None
    expires_at: datetime | None = None

    execution_intent: dict


class IngestionQueueListResponse(BaseModel):
    items: list[IngestionQueueItemOut]
    meta: dict = Field(default_factory=dict)
