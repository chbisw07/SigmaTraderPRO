from __future__ import annotations

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.orders.types import OrderProduct, OrderSide, OrderStatus, OrderType
from app.schemas.instrument import InstrumentOut


class StockOrderBase(BaseModel):
    broker: BrokerKey
    canonical_id: str = Field(min_length=3)
    side: OrderSide
    quantity: int = Field(ge=1)
    product: OrderProduct
    order_type: OrderType
    limit_price: float | None = Field(default=None, ge=0)


class StockOrderPreviewRequest(StockOrderBase):
    pass


class StockOrderCreateRequest(StockOrderBase):
    pass


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
    preview: StockOrderPreviewResponse
