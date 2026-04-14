from __future__ import annotations

from pydantic import BaseModel, Field


class TradingViewWebhookResponse(BaseModel):
    ok: bool
    status: str
    reason_code: str | None = None
    message: str
    correlation_id: str
    idempotency_key: str | None = None
    duplicate_ignored: bool = False
    ingestion_id: int | None = None
    queue_item_id: int | None = None


class TradingViewNormalizedPayload(BaseModel):
    source: str = "tradingview"
    schema_version: str
    idempotency_key: str

    strategy_id: str | None = None
    strategy_name: str | None = None
    strategy_params_json: dict | None = None

    symbol: str
    exchange: str | None = None
    instrument_type: str | None = None
    underlying: str | None = None
    expiry: str | None = None
    strike: float | None = Field(default=None, ge=0)
    option_type: str | None = None
    lots: int | None = Field(default=None, ge=1)
    lot_size: int | None = Field(default=None, ge=1)

    action: str
    side: str | None = None
    order_type: str | None = None
    product: str | None = None

    quantity: int | None = Field(default=None, ge=1)
    amount: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    stop_loss: float | None = None
    stop_loss_pct: float | None = None
    target: float | None = None
    target_pct: float | None = None
    trailing_sl: float | None = None
    trailing_sl_pct: float | None = None
    managed_exits: bool | None = None

    timeframe: str | None = None
    alert_timestamp: str | None = None
