from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.orders.types import OrderProduct, OrderType
from app.schemas.execution_intent import ProductMode
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
    policy: TradingViewRoutePolicy | None = None
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class TradingViewSizingMode(StrEnum):
    fixed_quantity = "fixed_quantity"
    fixed_amount = "fixed_amount"
    portfolio_percent = "portfolio_percent"


class PriceAndPctIn(BaseModel):
    price: float | None = Field(default=None, ge=0)
    pct: float | None = None


class TradingViewRoutePolicy(BaseModel):
    product_mode_default: ProductMode | None = None
    sizing_mode: TradingViewSizingMode | None = None
    fixed_quantity: int | None = Field(default=None, ge=1)
    fixed_amount: float | None = Field(default=None, ge=0)

    managed_exits_enabled: bool | None = None
    default_stop_loss: PriceAndPctIn | None = None
    default_target: PriceAndPctIn | None = None
    default_trailing_sl: PriceAndPctIn | None = None

    allow_payload_product: bool = True
    allow_payload_order_type: bool = True
    allow_payload_sizing: bool = True
    allow_payload_exits: bool = True


class WebhookRouteCreateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    default_broker_key: str | None = Field(default=None, max_length=50)
    default_execution_mode: QueueExecutionMode = QueueExecutionMode.manual_review
    default_product: OrderProduct | None = None
    default_order_type: OrderType | None = None
    policy: TradingViewRoutePolicy | None = None


class WebhookRouteCreateResponse(BaseModel):
    route: WebhookRouteOut
    route_token: str


class WebhookRouteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    default_broker_key: str | None = Field(default=None, max_length=50)
    default_execution_mode: QueueExecutionMode | None = None
    default_product: OrderProduct | None = None
    default_order_type: OrderType | None = None
    policy: TradingViewRoutePolicy | None = None
    is_enabled: bool | None = None
