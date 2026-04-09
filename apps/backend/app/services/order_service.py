from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.brokers.base import BrokerError
from app.brokers.types import BrokerKey
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.user import User
from app.orders.types import (
    BrokerEquityContract,
    EquityOrderRequest,
    EquityOrderResult,
    OrderProduct,
    OrderSide,
    OrderStatus,
    OrderType,
)
from app.services.broker_service import broker_service
from app.services.instrument_registry_service import instrument_registry_service


class OrderValidationError(ValueError):
    pass


class OrderDependencyError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class StockOrderPreview:
    instrument: Instrument
    broker: BrokerKey
    contract: BrokerEquityContract
    request: EquityOrderRequest
    warnings: list[str]


def _validate_cash_instrument(instrument: Instrument) -> None:
    if instrument.segment != "EQUITY":
        raise OrderValidationError("Only cash instruments are supported in S4.1")
    if instrument.instrument_type not in {"EQUITY", "ETF"}:
        raise OrderValidationError("Only stocks/ETFs are supported in S4.1")


def _validate_price(order_type: OrderType, limit_price: float | None) -> None:
    if order_type == OrderType.MARKET:
        return
    if limit_price is None:
        raise OrderValidationError("limit_price is required for LIMIT orders")
    if limit_price <= 0:
        raise OrderValidationError("limit_price must be > 0")


def _validate_broker_constraints(*, broker: BrokerKey, order_type: OrderType) -> None:
    # Zerodha/Kite can require "market protection" for market orders in some setups.
    # S4.1 stays minimal and requires LIMIT for Zerodha until it is modeled.
    if broker == BrokerKey.zerodha and order_type == OrderType.MARKET:
        raise OrderValidationError(
            "Zerodha MARKET orders require market protection; use LIMIT for now"
        )


def _resolve_contract(
    db: Session, *, instrument: Instrument, broker: BrokerKey
) -> BrokerEquityContract:
    # Angel requires symbol token for orders; use canonical mapping.
    if broker == BrokerKey.angel:
        mapping = instrument_registry_service.resolve_for_broker(
            db, canonical_id=instrument.canonical_id, broker=BrokerKey.angel
        )
        if not mapping or not mapping.broker_instrument_id:
            raise OrderValidationError(
                "Instrument is not mapped for Angel. Sync instruments first."
            )
        if not mapping.broker_trading_symbol:
            raise OrderValidationError("Angel mapping missing trading symbol")
        exchange = "NSE" if instrument.exchange == "NSE_EQ" else "BSE"
        return BrokerEquityContract(
            exchange=exchange,
            trading_symbol=str(mapping.broker_trading_symbol),
            symbol_token=str(mapping.broker_instrument_id),
        )

    # Zerodha supports orders via exchange+tradingsymbol.
    # Token is not required for cash.
    exchange = "NSE" if instrument.exchange == "NSE_EQ" else "BSE"
    return BrokerEquityContract(
        exchange=exchange,
        trading_symbol=str(instrument.symbol_root),
        symbol_token=None,
    )


class OrderService:
    def preview_stock_order(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey,
        canonical_id: str,
        side: OrderSide,
        quantity: int,
        product: OrderProduct,
        order_type: OrderType,
        limit_price: float | None,
    ) -> StockOrderPreview:
        if quantity <= 0:
            raise OrderValidationError("quantity must be >= 1")

        instrument = instrument_registry_service.get_by_canonical_id(db, canonical_id)
        if not instrument:
            raise OrderValidationError("Instrument not found")

        _validate_cash_instrument(instrument)
        _validate_broker_constraints(broker=broker, order_type=order_type)
        _validate_price(order_type, limit_price)

        status = broker_service.status(db, user, broker=broker)
        if not status.configured:
            raise OrderValidationError("Broker is not configured")
        if not status.enabled:
            raise OrderValidationError("Broker is disabled")
        if status.stale or not status.connected:
            raise OrderValidationError(
                "Broker session is not connected (reconnect required)"
            )

        contract = _resolve_contract(db, instrument=instrument, broker=broker)
        warnings: list[str] = []

        req = EquityOrderRequest(
            contract=contract,
            side=side,
            quantity=quantity,
            product=product,
            order_type=order_type,
            limit_price=limit_price if order_type == OrderType.LIMIT else None,
        )
        return StockOrderPreview(
            instrument=instrument,
            broker=broker,
            contract=contract,
            request=req,
            warnings=warnings,
        )

    def place_stock_order(
        self,
        db: Session,
        *,
        user: User,
        preview: StockOrderPreview,
    ) -> tuple[Order, EquityOrderResult]:
        # Catch the most common local-dev issue early: DB schema not migrated.
        try:
            if not inspect(db.get_bind()).has_table(Order.__tablename__):
                raise OrderDependencyError(
                    "Database schema not migrated (missing orders table). "
                    "Run: make backend-migrate"
                )
        except OrderDependencyError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise OrderDependencyError(f"Database schema check failed: {exc}") from exc

        adapter = broker_service.get_adapter(preview.broker)
        if not hasattr(adapter, "place_equity_order"):
            raise BrokerError("Broker adapter does not support equity orders yet")

        order = Order(
            user_id=user.id,
            broker_key=preview.broker.value,
            canonical_id=preview.instrument.canonical_id,
            side=preview.request.side.value,
            quantity=preview.request.quantity,
            product=preview.request.product.value,
            order_type=preview.request.order_type.value,
            limit_price=preview.request.limit_price,
            status=OrderStatus.CREATED.value,
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        try:
            result = adapter.place_equity_order(db, user, request=preview.request)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001
            order.status = OrderStatus.FAILED.value
            order.error_message = str(exc)
            db.commit()
            db.refresh(order)
            raise

        order.broker_order_id = result.broker_order_id
        order.status = OrderStatus.SUBMITTED.value
        user.last_used_broker = preview.broker.value
        db.commit()
        db.refresh(order)
        return order, result


order_service = OrderService()
