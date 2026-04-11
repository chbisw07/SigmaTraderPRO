from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.brokers.angel_client import AngelOrderError
from app.brokers.base import BrokerError
from app.brokers.types import BrokerKey
from app.brokers.zerodha_client import ZerodhaOrderError
from app.instruments.types import Exchange, InstrumentType, OptionType
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.user import User
from app.orders.types import (
    BrokerDerivativeContract,
    BrokerEquityContract,
    DerivativeOrderRequest,
    DerivativeOrderResult,
    EquityOrderRequest,
    EquityOrderResult,
    OrderIntentType,
    OrderProduct,
    OrderSide,
    OrderSource,
    OrderStatus,
    OrderTriggerMode,
    OrderType,
    RiskMode,
)
from app.services.broker_service import broker_service
from app.services.instrument_registry_service import instrument_registry_service
from app.services.position_service import position_service


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
    source: OrderSource
    intent_type: OrderIntentType
    trigger_mode: OrderTriggerMode
    risk_mode: RiskMode | None
    sl_value: float | None
    tp_value: float | None
    trailing_value: float | None
    parent_order_id: int | None
    linked_position_id: int | None
    broker_context: str | None
    warnings: list[str]


def _ensure_orders_schema(db: Session, *, require_lots: bool = False) -> None:
    try:
        inspector = inspect(db.get_bind())
        if not inspector.has_table(Order.__tablename__):
            raise OrderDependencyError(
                "Database schema not migrated (missing orders table). "
                "Run: make backend-migrate"
            )
        cols = {c.get("name") for c in inspector.get_columns(Order.__tablename__)}
        required_cols = {"source", "intent_type", "trigger_mode"}
        missing_cols = sorted([c for c in required_cols if c not in cols])
        if missing_cols:
            raise OrderDependencyError(
                "Database schema not migrated (orders missing: "
                f"{', '.join(missing_cols)}). "
                "Run: make backend-migrate"
            )
        if require_lots and "lots" not in cols:
            raise OrderDependencyError(
                "Database schema not migrated (orders.lots missing). "
                "Run: make backend-migrate"
            )
    except OrderDependencyError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise OrderDependencyError(f"Database schema check failed: {exc}") from exc


@dataclass(frozen=True, slots=True)
class FnoOrderPreview:
    instrument: Instrument
    broker: BrokerKey
    contract: BrokerDerivativeContract
    request: DerivativeOrderRequest
    lots: int
    source: OrderSource
    intent_type: OrderIntentType
    trigger_mode: OrderTriggerMode
    risk_mode: RiskMode | None
    sl_value: float | None
    tp_value: float | None
    trailing_value: float | None
    parent_order_id: int | None
    linked_position_id: int | None
    broker_context: str | None
    warnings: list[str]


def _validate_cash_instrument(instrument: Instrument) -> None:
    if instrument.segment != "EQUITY":
        raise OrderValidationError("Only cash instruments are supported in S4.1")
    if instrument.instrument_type not in {"EQUITY", "ETF"}:
        raise OrderValidationError("Only stocks/ETFs are supported in S4.1")


def _validate_cash_product(product: OrderProduct) -> None:
    if product not in {OrderProduct.CNC, OrderProduct.MIS}:
        raise OrderValidationError("Invalid product for cash orders (use CNC or MIS)")


def _validate_derivative_product(product: OrderProduct) -> None:
    if product not in {OrderProduct.MIS, OrderProduct.NRML}:
        raise OrderValidationError("Invalid product for F&O orders (use MIS or NRML)")


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


def _resolve_derivative_contract(
    db: Session, *, instrument: Instrument, broker: BrokerKey
) -> BrokerDerivativeContract:
    mapping = instrument_registry_service.resolve_for_broker(
        db, canonical_id=instrument.canonical_id, broker=broker
    )
    if not mapping:
        if broker == BrokerKey.zerodha:
            raise OrderValidationError(
                "Instrument is not mapped for Zerodha. Sync Zerodha NFO mappings first."
            )
        raise OrderValidationError("Instrument mapping not found for broker")

    if broker == BrokerKey.angel:
        if not mapping.broker_instrument_id:
            raise OrderValidationError("Angel mapping missing instrument token")
        if not mapping.broker_trading_symbol:
            raise OrderValidationError("Angel mapping missing trading symbol")
        return BrokerDerivativeContract(
            exchange="NFO",
            trading_symbol=str(mapping.broker_trading_symbol),
            symbol_token=str(mapping.broker_instrument_id),
        )

    if not mapping.broker_trading_symbol:
        raise OrderValidationError("Zerodha mapping missing trading symbol")
    return BrokerDerivativeContract(
        exchange="NFO",
        trading_symbol=str(mapping.broker_trading_symbol),
        symbol_token=None,
    )


def _find_derivative_instrument(
    db: Session,
    *,
    instrument_type: InstrumentType,
    underlying: str,
    expiry,
    strike: float | None,
    option_type: OptionType | None,
) -> Instrument | None:
    normalized = underlying.strip().upper()
    if not normalized:
        return None

    qry = (
        db.query(Instrument)
        .filter(Instrument.is_active.is_(True))
        .filter(Instrument.exchange == Exchange.NSE_FNO.value)
        .filter(Instrument.instrument_type == instrument_type.value)
        .filter(Instrument.underlying == normalized)
        .filter(Instrument.expiry == expiry)
    )

    if instrument_type == InstrumentType.OPTION:
        if strike is None or option_type is None:
            return None
        qry = qry.filter(Instrument.strike == strike).filter(
            Instrument.option_type == option_type.value
        )
    else:
        qry = qry.filter(Instrument.strike.is_(None)).filter(
            Instrument.option_type.is_(None)
        )

    return qry.one_or_none()


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
        source: OrderSource = OrderSource.manual_ui,
        intent_type: OrderIntentType = OrderIntentType.ENTRY,
        risk_mode: RiskMode | None = None,
        sl_value: float | None = None,
        tp_value: float | None = None,
        trailing_value: float | None = None,
        parent_order_id: int | None = None,
        linked_position_id: int | None = None,
        broker_context: str | None = None,
    ) -> StockOrderPreview:
        if quantity <= 0:
            raise OrderValidationError("quantity must be >= 1")

        instrument = instrument_registry_service.get_by_canonical_id(db, canonical_id)
        if not instrument:
            raise OrderValidationError("Instrument not found")

        _validate_cash_instrument(instrument)
        _validate_cash_product(product)
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
            source=source,
            intent_type=intent_type,
            trigger_mode=(
                OrderTriggerMode.LIMIT
                if order_type == OrderType.LIMIT
                else OrderTriggerMode.MARKET
            ),
            risk_mode=risk_mode,
            sl_value=sl_value,
            tp_value=tp_value,
            trailing_value=trailing_value,
            parent_order_id=parent_order_id,
            linked_position_id=linked_position_id,
            broker_context=broker_context,
            warnings=warnings,
        )

    def preview_fno_order(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey,
        instrument_type: InstrumentType,
        underlying: str,
        expiry,
        strike: float | None,
        option_type: OptionType | None,
        side: OrderSide,
        lots: int,
        product: OrderProduct,
        order_type: OrderType,
        limit_price: float | None,
        source: OrderSource = OrderSource.manual_ui,
        intent_type: OrderIntentType = OrderIntentType.ENTRY,
        risk_mode: RiskMode | None = None,
        sl_value: float | None = None,
        tp_value: float | None = None,
        trailing_value: float | None = None,
        parent_order_id: int | None = None,
        linked_position_id: int | None = None,
        broker_context: str | None = None,
    ) -> FnoOrderPreview:
        if instrument_type not in {InstrumentType.OPTION, InstrumentType.FUTURE}:
            raise OrderValidationError("instrument_type must be OPTION or FUTURE")
        if lots <= 0:
            raise OrderValidationError("lots must be >= 1")

        _validate_derivative_product(product)
        _validate_broker_constraints(broker=broker, order_type=order_type)
        _validate_price(order_type, limit_price)

        instrument = _find_derivative_instrument(
            db,
            instrument_type=instrument_type,
            underlying=underlying,
            expiry=expiry,
            strike=strike,
            option_type=option_type,
        )
        if not instrument:
            raise OrderValidationError("F&O instrument not found")

        if not instrument.lot_size or instrument.lot_size <= 0:
            raise OrderValidationError("Instrument lot_size is missing")

        status = broker_service.status(db, user, broker=broker)
        if not status.configured:
            raise OrderValidationError("Broker is not configured")
        if not status.enabled:
            raise OrderValidationError("Broker is disabled")
        if status.stale or not status.connected:
            raise OrderValidationError(
                "Broker session is not connected (reconnect required)"
            )

        quantity = int(lots) * int(instrument.lot_size)
        contract = _resolve_derivative_contract(
            db, instrument=instrument, broker=broker
        )
        warnings: list[str] = []

        req = DerivativeOrderRequest(
            contract=contract,
            side=side,
            quantity=quantity,
            product=product,
            order_type=order_type,
            limit_price=limit_price if order_type == OrderType.LIMIT else None,
        )
        return FnoOrderPreview(
            instrument=instrument,
            broker=broker,
            contract=contract,
            request=req,
            lots=lots,
            source=source,
            intent_type=intent_type,
            trigger_mode=(
                OrderTriggerMode.LIMIT
                if order_type == OrderType.LIMIT
                else OrderTriggerMode.MARKET
            ),
            risk_mode=risk_mode,
            sl_value=sl_value,
            tp_value=tp_value,
            trailing_value=trailing_value,
            parent_order_id=parent_order_id,
            linked_position_id=linked_position_id,
            broker_context=broker_context,
            warnings=warnings,
        )

    def place_stock_order(
        self,
        db: Session,
        *,
        user: User,
        preview: StockOrderPreview,
    ) -> tuple[Order, EquityOrderResult]:
        _ensure_orders_schema(db, require_lots=False)

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
            avg_executed_price=None,
            status=OrderStatus.PENDING.value,
            source=preview.source.value,
            intent_type=preview.intent_type.value,
            trigger_mode=preview.trigger_mode.value,
            risk_mode=preview.risk_mode.value if preview.risk_mode else None,
            sl_value=preview.sl_value,
            tp_value=preview.tp_value,
            trailing_value=preview.trailing_value,
            parent_order_id=preview.parent_order_id,
            linked_position_id=preview.linked_position_id,
            broker_context=preview.broker_context,
            broker_symbol_resolved=preview.contract.trading_symbol,
            broker_symbol_token_resolved=preview.contract.symbol_token,
            lot_size_snapshot=preview.instrument.lot_size,
            preview_snapshot_json={
                "canonical_id": preview.instrument.canonical_id,
                "broker": preview.broker.value,
                "exchange": preview.contract.exchange,
                "trading_symbol": preview.contract.trading_symbol,
                "side": preview.request.side.value,
                "quantity": preview.request.quantity,
                "product": preview.request.product.value,
                "order_type": preview.request.order_type.value,
                "limit_price": preview.request.limit_price,
            },
            broker_payload_json={
                "exchange": preview.contract.exchange,
                "trading_symbol": preview.contract.trading_symbol,
                "symbol_token": preview.contract.symbol_token,
                "side": preview.request.side.value,
                "quantity": preview.request.quantity,
                "product": preview.request.product.value,
                "order_type": preview.request.order_type.value,
                "limit_price": preview.request.limit_price,
            },
            margin_snapshot_json=None,
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        try:
            result = adapter.place_equity_order(db, user, request=preview.request)  # type: ignore[attr-defined]
        except (AngelOrderError, ZerodhaOrderError) as exc:
            order.status = OrderStatus.REJECTED.value
            order.error_message = str(exc)
            db.commit()
            db.refresh(order)
            raise
        except Exception as exc:  # noqa: BLE001
            order.status = OrderStatus.FAILED.value
            order.error_message = str(exc)
            db.commit()
            db.refresh(order)
            raise

        order.broker_order_id = result.broker_order_id
        order.status = OrderStatus.PENDING.value
        user.last_used_broker = preview.broker.value
        position = position_service.apply_order(db, user=user, order=order)
        order.linked_position_id = position.id if position else None
        db.commit()
        db.refresh(order)
        return order, result

    def place_fno_order(
        self,
        db: Session,
        *,
        user: User,
        preview: FnoOrderPreview,
    ) -> tuple[Order, DerivativeOrderResult]:
        _ensure_orders_schema(db, require_lots=True)

        adapter = broker_service.get_adapter(preview.broker)
        if not hasattr(adapter, "place_derivative_order"):
            raise BrokerError("Broker adapter does not support F&O orders yet")

        order = Order(
            user_id=user.id,
            broker_key=preview.broker.value,
            canonical_id=preview.instrument.canonical_id,
            side=preview.request.side.value,
            quantity=preview.request.quantity,
            product=preview.request.product.value,
            order_type=preview.request.order_type.value,
            limit_price=preview.request.limit_price,
            avg_executed_price=None,
            status=OrderStatus.PENDING.value,
            source=preview.source.value,
            intent_type=preview.intent_type.value,
            trigger_mode=preview.trigger_mode.value,
            risk_mode=preview.risk_mode.value if preview.risk_mode else None,
            sl_value=preview.sl_value,
            tp_value=preview.tp_value,
            trailing_value=preview.trailing_value,
            parent_order_id=preview.parent_order_id,
            linked_position_id=preview.linked_position_id,
            broker_context=preview.broker_context,
            broker_symbol_resolved=preview.contract.trading_symbol,
            broker_symbol_token_resolved=preview.contract.symbol_token,
            lot_size_snapshot=preview.instrument.lot_size,
            preview_snapshot_json={
                "canonical_id": preview.instrument.canonical_id,
                "broker": preview.broker.value,
                "exchange": preview.contract.exchange,
                "trading_symbol": preview.contract.trading_symbol,
                "side": preview.request.side.value,
                "lots": preview.lots,
                "quantity": preview.request.quantity,
                "product": preview.request.product.value,
                "order_type": preview.request.order_type.value,
                "limit_price": preview.request.limit_price,
            },
            broker_payload_json={
                "exchange": preview.contract.exchange,
                "trading_symbol": preview.contract.trading_symbol,
                "symbol_token": preview.contract.symbol_token,
                "side": preview.request.side.value,
                "quantity": preview.request.quantity,
                "product": preview.request.product.value,
                "order_type": preview.request.order_type.value,
                "limit_price": preview.request.limit_price,
            },
            margin_snapshot_json=None,
            lots=preview.lots,
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        try:
            result = adapter.place_derivative_order(  # type: ignore[attr-defined]
                db, user, request=preview.request
            )
        except (AngelOrderError, ZerodhaOrderError) as exc:
            order.status = OrderStatus.REJECTED.value
            order.error_message = str(exc)
            db.commit()
            db.refresh(order)
            raise
        except Exception as exc:  # noqa: BLE001
            order.status = OrderStatus.FAILED.value
            order.error_message = str(exc)
            db.commit()
            db.refresh(order)
            raise

        order.broker_order_id = result.broker_order_id
        order.status = OrderStatus.PENDING.value
        user.last_used_broker = preview.broker.value
        position = position_service.apply_order(db, user=user, order=order)
        order.linked_position_id = position.id if position else None
        db.commit()
        db.refresh(order)
        return order, result


order_service = OrderService()
