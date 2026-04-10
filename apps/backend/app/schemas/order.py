from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey
from app.instruments.types import InstrumentType, OptionType
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


class FnoOrderPreviewRequest(FnoOrderBase):
    pass


class FnoOrderCreateRequest(FnoOrderBase):
    pass


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
    preview: FnoOrderPreviewResponse
