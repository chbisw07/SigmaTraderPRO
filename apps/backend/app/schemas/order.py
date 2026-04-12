from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.instruments.types import InstrumentType, OptionType
from app.orders.types import (
    OrderIntentType,
    OrderProduct,
    OrderSide,
    OrderSource,
    OrderStatus,
    OrderTriggerMode,
    OrderType,
    RiskMode,
)
from app.schemas.execution_intent import ExecutionIntent
from app.schemas.instrument import InstrumentOut


class OrderIntentMetadata(BaseModel):
    source: OrderSource = OrderSource.manual_ui
    intent_type: OrderIntentType = OrderIntentType.ENTRY
    trigger_mode: OrderTriggerMode | None = None
    risk_mode: RiskMode | None = None
    sl_value: float | None = Field(default=None, ge=0)
    tp_value: float | None = Field(default=None, ge=0)
    trailing_value: float | None = Field(default=None, ge=0)
    parent_order_id: int | None = None
    linked_position_id: int | None = None
    broker_context: str | None = None


class StockOrderBase(BaseModel):
    broker: BrokerKey
    canonical_id: str = Field(min_length=3)
    side: OrderSide
    quantity: int = Field(ge=1)
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = Field(default=None, ge=0)


class StockOrderPreviewRequest(StockOrderBase, OrderIntentMetadata):
    execution_intent: ExecutionIntent | None = None


class StockOrderCreateRequest(StockOrderBase, OrderIntentMetadata):
    correlation_id: str | None = None
    dispatch_tags: dict[str, str] | None = None
    execution_intent: ExecutionIntent | None = None


class BrokerRouting(BaseModel):
    broker: BrokerKey
    exchange: str
    trading_symbol: str


class StockOrderPreviewResponse(BaseModel):
    instrument: InstrumentOut
    routing: BrokerRouting
    side: OrderSide
    quantity: int
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None
    warnings: list[str] = Field(default_factory=list)


class StockOrderCreateResponse(BaseModel):
    order_id: int
    status: OrderStatus
    broker_order_id: str | None = None
    correlation_id: str
    blocked_reason_code: str | None = None
    blocked_reason_message: str | None = None
    failure_reason_code: str | None = None
    failure_reason_message: str | None = None
    preview: StockOrderPreviewResponse


class FnoOrderBase(BaseModel):
    broker: BrokerKey
    instrument_type: InstrumentType
    underlying: str = Field(min_length=1)
    expiry: date
    strike: float | None = Field(default=None, ge=0)
    option_type: OptionType | None = None
    side: OrderSide
    lots: int = Field(ge=1)
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = Field(default=None, ge=0)


class FnoOrderPreviewRequest(FnoOrderBase, OrderIntentMetadata):
    execution_intent: ExecutionIntent | None = None


class FnoOrderCreateRequest(FnoOrderBase, OrderIntentMetadata):
    correlation_id: str | None = None
    dispatch_tags: dict[str, str] | None = None
    execution_intent: ExecutionIntent | None = None


class FnoOrderPreviewResponse(BaseModel):
    instrument: InstrumentOut
    routing: BrokerRouting
    side: OrderSide
    lots: int
    quantity: int
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None
    warnings: list[str] = Field(default_factory=list)


class FnoOrderCreateResponse(BaseModel):
    order_id: int
    status: OrderStatus
    broker_order_id: str | None = None
    correlation_id: str
    blocked_reason_code: str | None = None
    blocked_reason_message: str | None = None
    failure_reason_code: str | None = None
    failure_reason_message: str | None = None
    preview: FnoOrderPreviewResponse


class OrderOut(BaseModel):
    id: int
    created_at: str
    updated_at: str

    broker: BrokerKey
    canonical_id: str
    instrument: InstrumentOut | None = None

    side: OrderSide
    quantity: int
    lots: int | None = None
    product: OrderProduct
    order_type: OrderType
    placed_price: float | None = None
    avg_executed_price: float | None = None

    status: OrderStatus | None = None
    broker_order_id: str | None = None
    rejection_reason: str | None = None
    correlation_id: str | None = None
    blocked_reason_code: str | None = None
    blocked_reason_message: str | None = None
    failure_reason_code: str | None = None
    failure_reason_message: str | None = None

    source: OrderSource
    intent_type: OrderIntentType
    trigger_mode: OrderTriggerMode

    linked_position_id: int | None = None


class OrderListResponse(BaseModel):
    items: list[OrderOut]


class OrderDetailResponse(BaseModel):
    order: OrderOut
    preview_snapshot_json: dict | None = None
    broker_payload_json: dict | None = None
    execution_intent_json: dict | None = None


class OrderDraft(BaseModel):
    mode: str = "contract"
    instrument: InstrumentOut
    broker: BrokerKey
    side: OrderSide
    quantity: int | None = None
    lots: int | None = None
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = None
    reference_price: float | None = None
    intent: OrderIntentMetadata
    execution_intent: ExecutionIntent | None = None


class OrderDraftResponse(BaseModel):
    draft: OrderDraft
