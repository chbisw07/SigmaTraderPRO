from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.orders.types import OrderProduct, OrderType
from app.schemas.ingestion_queue import QueueExecutionMode


class WebhookRouteOut(BaseModel):
    id: int
    user_id: int
    source: str
    name: str | None = None
    default_broker_key: str | None = None
    default_execution_mode: QueueExecutionMode
    default_product: str | None = None
    default_order_type: str | None = None
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class WebhookRouteCreateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    default_broker_key: str | None = Field(default=None, max_length=50)
    default_execution_mode: QueueExecutionMode = QueueExecutionMode.manual_review
    default_product: OrderProduct | None = None
    default_order_type: OrderType | None = None


class WebhookRouteCreateResponse(BaseModel):
    route: WebhookRouteOut
    route_token: str


class WebhookRouteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    default_broker_key: str | None = Field(default=None, max_length=50)
    default_execution_mode: QueueExecutionMode | None = None
    default_product: OrderProduct | None = None
    default_order_type: OrderType | None = None
    is_enabled: bool | None = None
