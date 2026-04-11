from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.user import User
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
from app.schemas.instrument import InstrumentOut
from app.schemas.order import (
    FnoOrderCreateRequest,
    FnoOrderCreateResponse,
    FnoOrderPreviewRequest,
    FnoOrderPreviewResponse,
    OrderDetailResponse,
    OrderDraft,
    OrderDraftResponse,
    OrderListResponse,
    OrderOut,
    StockOrderCreateRequest,
    StockOrderCreateResponse,
    StockOrderPreviewRequest,
    StockOrderPreviewResponse,
)
from app.schemas.orders_workspace import OrdersSourceMode, OrdersWorkspaceResponse
from app.services.order_service import (
    OrderDependencyError,
    OrderValidationError,
    order_service,
)
from app.services.orders_workspace_service import orders_workspace_service

router = APIRouter(prefix="/orders", tags=["orders"])
logger = get_logger(__name__)


def _coerce_status(raw: str | None) -> OrderStatus | None:
    if not raw:
        return None
    up = raw.upper()
    for s in OrderStatus:
        if s.value == up:
            return s
    # Back-compat for older rows.
    if raw.lower() in {"submitted", "created", "previewed"}:
        return OrderStatus.PENDING
    if raw.lower() in {"failed"}:
        return OrderStatus.FAILED
    return None


def _order_out(order: Order, instrument: Instrument | None) -> OrderOut:
    created = order.created_at
    updated = order.updated_at
    if isinstance(created, datetime):
        created_at = created.astimezone(UTC).isoformat().replace("+00:00", "Z")
    else:
        created_at = str(created)
    if isinstance(updated, datetime):
        updated_at = updated.astimezone(UTC).isoformat().replace("+00:00", "Z")
    else:
        updated_at = str(updated)

    inst_out = (
        InstrumentOut.model_validate(instrument, from_attributes=True)
        if instrument
        else None
    )

    return OrderOut(
        id=order.id,
        created_at=created_at,
        updated_at=updated_at,
        broker=order.broker_key,  # type: ignore[arg-type]
        canonical_id=order.canonical_id,
        instrument=inst_out,
        side=OrderSide(order.side),
        quantity=order.quantity,
        lots=order.lots,
        product=OrderProduct(order.product),
        order_type=OrderType(order.order_type),
        placed_price=(
            float(order.limit_price) if order.limit_price is not None else None
        ),
        avg_executed_price=(
            float(order.avg_executed_price)
            if order.avg_executed_price is not None
            else None
        ),
        status=_coerce_status(order.status),
        broker_order_id=order.broker_order_id,
        rejection_reason=order.error_message,
        correlation_id=getattr(order, "correlation_id", None),
        blocked_reason_code=getattr(order, "blocked_reason_code", None),
        blocked_reason_message=getattr(order, "blocked_reason_message", None),
        failure_reason_code=getattr(order, "failure_reason_code", None),
        failure_reason_message=getattr(order, "failure_reason_message", None),
        source=OrderSource(order.source or OrderSource.manual_ui.value),
        intent_type=OrderIntentType(order.intent_type or OrderIntentType.ENTRY.value),
        trigger_mode=OrderTriggerMode(
            order.trigger_mode or OrderTriggerMode.MARKET.value
        ),
        linked_position_id=order.linked_position_id,
    )


class _OrderIdRequest(BaseModel):
    order_id: int


@router.post("/preview", response_model=StockOrderPreviewResponse)
def preview(
    payload: StockOrderPreviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockOrderPreviewResponse:
    try:
        out = order_service.preview_stock_order(
            db,
            user=current_user,
            broker=payload.broker,
            canonical_id=payload.canonical_id,
            side=payload.side,
            quantity=payload.quantity,
            product=payload.product,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
            source=payload.source,
            intent_type=payload.intent_type,
            risk_mode=payload.risk_mode,
            sl_value=payload.sl_value,
            tp_value=payload.tp_value,
            trailing_value=payload.trailing_value,
            parent_order_id=payload.parent_order_id,
            linked_position_id=payload.linked_position_id,
            broker_context=payload.broker_context,
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    log_event(
        logger,
        "order_preview",
        category="orders",
        event_type="preview",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=payload.canonical_id,
        action="preview",
        status="ok",
    )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="preview",
            message="order_preview_ok",
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="preview",
            status="ok",
            details={
                "side": payload.side.value,
                "quantity": payload.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
            },
        )

    return StockOrderPreviewResponse(
        instrument=InstrumentOut.model_validate(out.instrument, from_attributes=True),
        routing={
            "broker": out.broker,
            "exchange": out.contract.exchange,
            "trading_symbol": out.contract.trading_symbol,
        },
        side=payload.side,
        quantity=payload.quantity,
        product=payload.product,
        order_type=payload.order_type,
        limit_price=(
            payload.limit_price if payload.order_type == OrderType.LIMIT else None
        ),
        warnings=out.warnings,
    )


@router.post("", response_model=StockOrderCreateResponse)
def create(
    payload: StockOrderCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockOrderCreateResponse:
    correlation_id = payload.correlation_id or str(uuid4())
    log_event(
        logger,
        "order_submission_started",
        category="orders",
        event_type="create",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=payload.canonical_id,
        action="create",
        correlation_id=correlation_id,
        status="started",
    )

    try:
        preview = order_service.preview_stock_order(
            db,
            user=current_user,
            broker=payload.broker,
            canonical_id=payload.canonical_id,
            side=payload.side,
            quantity=payload.quantity,
            product=payload.product,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
            source=payload.source,
            intent_type=payload.intent_type,
            risk_mode=payload.risk_mode,
            sl_value=payload.sl_value,
            tp_value=payload.tp_value,
            trailing_value=payload.trailing_value,
            parent_order_id=payload.parent_order_id,
            linked_position_id=payload.linked_position_id,
            broker_context=payload.broker_context,
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    try:
        order, result, gate = order_service.place_stock_order(
            db,
            user=current_user,
            preview=preview,
            correlation_id=correlation_id,
            dispatch_tags=payload.dispatch_tags,
        )
    except OrderDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        log_event(
            logger,
            "order_db_error",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="failed",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating order",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            "order_create_failed",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="failed",
            error=str(exc),
        )
        audit = getattr(request.app.state, "csv_audit", None)
        if audit:
            audit.log(
                level="ERROR",
                module=__name__,
                category="orders",
                event_type="create",
                message="order_create_failed",
                user_id=str(current_user.id),
                broker=payload.broker.value,
                instrument_key=payload.canonical_id,
                action="create",
                status="failed",
                details={"error": str(exc)},
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Broker order placement failed",
        ) from exc

    outcome_status = _coerce_status(order.status)
    if outcome_status == OrderStatus.BLOCKED:
        log_event(
            logger,
            "order_blocked",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="blocked",
            order_id=order.id,
            correlation_id=correlation_id,
            reason_code=getattr(order, "blocked_reason_code", None),
        )
    elif outcome_status in {
        OrderStatus.DISPATCH_FAILED,
        OrderStatus.REJECTED,
        OrderStatus.FAILED,
    }:
        log_event(
            logger,
            "order_dispatch_failed",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="failed",
            order_id=order.id,
            correlation_id=correlation_id,
            reason_code=getattr(order, "failure_reason_code", None),
        )
    else:
        log_event(
            logger,
            "order_acknowledged",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="ok",
            order_id=order.id,
            broker_order_id=getattr(order, "broker_order_id", None),
            correlation_id=correlation_id,
        )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="create",
            message="order_created",
            correlation_id=correlation_id,
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status=str(outcome_status.value if outcome_status else "unknown").lower(),
            details={
                "order_id": order.id,
                "broker_order_id": getattr(order, "broker_order_id", None),
                "side": payload.side.value,
                "quantity": payload.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
                "gate_allowed": getattr(gate, "allowed", None),
                "gate_reason_code": getattr(gate, "reason_code", None),
            },
        )

    preview_response = StockOrderPreviewResponse(
        instrument=InstrumentOut.model_validate(
            preview.instrument, from_attributes=True
        ),
        routing={
            "broker": preview.broker,
            "exchange": preview.contract.exchange,
            "trading_symbol": preview.contract.trading_symbol,
        },
        side=payload.side,
        quantity=payload.quantity,
        product=payload.product,
        order_type=payload.order_type,
        limit_price=(
            payload.limit_price if payload.order_type == OrderType.LIMIT else None
        ),
        warnings=preview.warnings,
    )

    return StockOrderCreateResponse(
        order_id=order.id,
        status=outcome_status or OrderStatus.PENDING,
        broker_order_id=getattr(order, "broker_order_id", None),
        correlation_id=correlation_id,
        blocked_reason_code=getattr(order, "blocked_reason_code", None),
        blocked_reason_message=getattr(order, "blocked_reason_message", None),
        failure_reason_code=getattr(order, "failure_reason_code", None),
        failure_reason_message=getattr(order, "failure_reason_message", None),
        preview=preview_response,
    )


@router.post("/fno/preview", response_model=FnoOrderPreviewResponse)
def preview_fno(
    payload: FnoOrderPreviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FnoOrderPreviewResponse:
    try:
        out = order_service.preview_fno_order(
            db,
            user=current_user,
            broker=payload.broker,
            instrument_type=payload.instrument_type,
            underlying=payload.underlying,
            expiry=payload.expiry,
            strike=payload.strike,
            option_type=payload.option_type,
            side=payload.side,
            lots=payload.lots,
            product=payload.product,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
            source=payload.source,
            intent_type=payload.intent_type,
            risk_mode=payload.risk_mode,
            sl_value=payload.sl_value,
            tp_value=payload.tp_value,
            trailing_value=payload.trailing_value,
            parent_order_id=payload.parent_order_id,
            linked_position_id=payload.linked_position_id,
            broker_context=payload.broker_context,
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    log_event(
        logger,
        "order_preview_fno",
        category="orders",
        event_type="preview",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=out.instrument.canonical_id,
        action="preview",
        status="ok",
    )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="preview",
            message="order_preview_fno_ok",
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=out.instrument.canonical_id,
            action="preview",
            status="ok",
            details={
                "side": payload.side.value,
                "lots": payload.lots,
                "quantity": out.request.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
            },
        )

    return FnoOrderPreviewResponse(
        instrument=InstrumentOut.model_validate(out.instrument, from_attributes=True),
        routing={
            "broker": out.broker,
            "exchange": out.contract.exchange,
            "trading_symbol": out.contract.trading_symbol,
        },
        side=payload.side,
        lots=payload.lots,
        quantity=out.request.quantity,
        product=payload.product,
        order_type=payload.order_type,
        limit_price=(
            payload.limit_price if payload.order_type == OrderType.LIMIT else None
        ),
        warnings=out.warnings,
    )


@router.post("/fno", response_model=FnoOrderCreateResponse)
def create_fno(
    payload: FnoOrderCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FnoOrderCreateResponse:
    correlation_id = payload.correlation_id or str(uuid4())
    log_event(
        logger,
        "order_submission_started",
        category="orders",
        event_type="create",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=str(payload.underlying),
        action="create_fno",
        correlation_id=correlation_id,
        status="started",
    )

    try:
        preview = order_service.preview_fno_order(
            db,
            user=current_user,
            broker=payload.broker,
            instrument_type=payload.instrument_type,
            underlying=payload.underlying,
            expiry=payload.expiry,
            strike=payload.strike,
            option_type=payload.option_type,
            side=payload.side,
            lots=payload.lots,
            product=payload.product,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
            source=payload.source,
            intent_type=payload.intent_type,
            risk_mode=payload.risk_mode,
            sl_value=payload.sl_value,
            tp_value=payload.tp_value,
            trailing_value=payload.trailing_value,
            parent_order_id=payload.parent_order_id,
            linked_position_id=payload.linked_position_id,
            broker_context=payload.broker_context,
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    try:
        order, result, gate = order_service.place_fno_order(
            db,
            user=current_user,
            preview=preview,
            correlation_id=correlation_id,
            dispatch_tags=payload.dispatch_tags,
        )
    except OrderDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        log_event(
            logger,
            "order_db_error",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create",
            status="failed",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating order",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            "order_create_failed",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create",
            status="failed",
            error=str(exc),
        )
        audit = getattr(request.app.state, "csv_audit", None)
        if audit:
            audit.log(
                level="ERROR",
                module=__name__,
                category="orders",
                event_type="create",
                message="order_create_fno_failed",
                user_id=str(current_user.id),
                broker=payload.broker.value,
                instrument_key=preview.instrument.canonical_id,
                action="create",
                status="failed",
                details={"error": str(exc)},
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Broker order placement failed",
        ) from exc

    outcome_status = _coerce_status(order.status)
    if outcome_status == OrderStatus.BLOCKED:
        log_event(
            logger,
            "order_blocked",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create_fno",
            status="blocked",
            order_id=order.id,
            correlation_id=correlation_id,
            reason_code=getattr(order, "blocked_reason_code", None),
        )
    elif outcome_status in {
        OrderStatus.DISPATCH_FAILED,
        OrderStatus.REJECTED,
        OrderStatus.FAILED,
    }:
        log_event(
            logger,
            "order_dispatch_failed",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create_fno",
            status="failed",
            order_id=order.id,
            correlation_id=correlation_id,
            reason_code=getattr(order, "failure_reason_code", None),
        )
    else:
        log_event(
            logger,
            "order_acknowledged",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create_fno",
            status="ok",
            order_id=order.id,
            broker_order_id=getattr(order, "broker_order_id", None),
            correlation_id=correlation_id,
        )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="create",
            message="order_created_fno",
            correlation_id=correlation_id,
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create",
            status=str(outcome_status.value if outcome_status else "unknown").lower(),
            details={
                "order_id": order.id,
                "broker_order_id": getattr(order, "broker_order_id", None),
                "side": payload.side.value,
                "lots": payload.lots,
                "quantity": preview.request.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
                "gate_allowed": getattr(gate, "allowed", None),
                "gate_reason_code": getattr(gate, "reason_code", None),
            },
        )

    preview_response = FnoOrderPreviewResponse(
        instrument=InstrumentOut.model_validate(
            preview.instrument, from_attributes=True
        ),
        routing={
            "broker": preview.broker,
            "exchange": preview.contract.exchange,
            "trading_symbol": preview.contract.trading_symbol,
        },
        side=payload.side,
        lots=payload.lots,
        quantity=preview.request.quantity,
        product=payload.product,
        order_type=payload.order_type,
        limit_price=(
            payload.limit_price if payload.order_type == OrderType.LIMIT else None
        ),
        warnings=preview.warnings,
    )

    return FnoOrderCreateResponse(
        order_id=order.id,
        status=outcome_status or OrderStatus.PENDING,
        broker_order_id=getattr(order, "broker_order_id", None),
        correlation_id=correlation_id,
        blocked_reason_code=getattr(order, "blocked_reason_code", None),
        blocked_reason_message=getattr(order, "blocked_reason_message", None),
        failure_reason_code=getattr(order, "failure_reason_code", None),
        failure_reason_message=getattr(order, "failure_reason_message", None),
        preview=preview_response,
    )


@router.get("", response_model=OrderListResponse)
def list_orders(
    broker: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    instrument_type: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderListResponse:
    qry = (
        db.query(Order, Instrument)
        .outerjoin(Instrument, Instrument.canonical_id == Order.canonical_id)
        .filter(Order.user_id == current_user.id)
    )
    if broker:
        qry = qry.filter(Order.broker_key == broker)
    if status_filter:
        qry = qry.filter(Order.status.ilike(status_filter))
    if instrument_type:
        qry = qry.filter(Instrument.instrument_type == instrument_type)
    if q:
        like = f"%{q.strip().upper()}%"
        qry = qry.filter(
            (Order.canonical_id.ilike(like))
            | (Instrument.display_symbol.ilike(like))
            | (Instrument.symbol_root.ilike(like))
            | (Instrument.underlying.ilike(like))
        )

    rows = qry.order_by(Order.created_at.desc()).limit(limit).all()
    items: list[OrderOut] = []
    for order, inst in rows:
        items.append(_order_out(order, inst))
    return OrderListResponse(items=items)


@router.get("/workspace", response_model=OrdersWorkspaceResponse)
def workspace(
    mode: OrdersSourceMode = Query(default=OrdersSourceMode.merged),
    broker: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    instrument_type: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrdersWorkspaceResponse:
    return orders_workspace_service.list_workspace(
        db,
        user=current_user,
        include_broker_orders=bool(
            getattr(current_user, "include_broker_orders", True)
        ),
        mode=mode,
        broker=broker,
        status_filter=status_filter,
        instrument_type=instrument_type,
        q=q,
        limit=limit,
    )


@router.get("/{order_id}", response_model=OrderDetailResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderDetailResponse:
    row = (
        db.query(Order, Instrument)
        .outerjoin(Instrument, Instrument.canonical_id == Order.canonical_id)
        .filter(Order.user_id == current_user.id)
        .filter(Order.id == order_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    order, inst = row
    return OrderDetailResponse(
        order=_order_out(order, inst),
        preview_snapshot_json=order.preview_snapshot_json,
        broker_payload_json=order.broker_payload_json,
    )


@router.post("/repeat", response_model=OrderDraftResponse)
def repeat_order(
    payload: _OrderIdRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderDraftResponse:
    row = (
        db.query(Order, Instrument)
        .outerjoin(Instrument, Instrument.canonical_id == Order.canonical_id)
        .filter(Order.user_id == current_user.id)
        .filter(Order.id == payload.order_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    order, inst = row
    if not inst:
        raise HTTPException(status_code=400, detail="Instrument not found for order")

    draft = OrderDraft(
        instrument=InstrumentOut.model_validate(inst, from_attributes=True),
        broker=order.broker_key,  # type: ignore[arg-type]
        side=OrderSide(order.side),
        quantity=order.quantity if inst.segment == "EQUITY" else None,
        lots=order.lots,
        product=OrderProduct(order.product),
        order_type=OrderType(order.order_type),
        limit_price=(
            float(order.limit_price) if order.limit_price is not None else None
        ),
        reference_price=(
            float(order.limit_price) if order.limit_price is not None else None
        ),
        intent={
            "source": OrderSource(order.source or OrderSource.manual_ui.value),
            "intent_type": OrderIntentType(
                order.intent_type or OrderIntentType.ENTRY.value
            ),
            "trigger_mode": OrderTriggerMode(
                order.trigger_mode or OrderTriggerMode.MARKET.value
            ),
            "risk_mode": RiskMode(order.risk_mode) if order.risk_mode else None,
            "sl_value": float(order.sl_value) if order.sl_value is not None else None,
            "tp_value": float(order.tp_value) if order.tp_value is not None else None,
            "trailing_value": (
                float(order.trailing_value)
                if order.trailing_value is not None
                else None
            ),
            "parent_order_id": order.id,
            "linked_position_id": order.linked_position_id,
            "broker_context": order.broker_context,
        },
    )
    return OrderDraftResponse(draft=draft)


@router.post("/reverse", response_model=OrderDraftResponse)
def reverse_order(
    payload: _OrderIdRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderDraftResponse:
    res = repeat_order(payload, db=db, current_user=current_user)
    # Flip side; mark as EXIT intent by default.
    # (Fast reverse workflow can override in UI.)
    res.draft.side = (
        OrderSide.SELL if res.draft.side == OrderSide.BUY else OrderSide.BUY
    )
    res.draft.intent.intent_type = OrderIntentType.EXIT
    res.draft.intent.parent_order_id = payload.order_id
    return res


@router.post("/reconcile")
def reconcile_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    updated, broker_errors = orders_workspace_service.reconcile_internal_orders(
        db, user=current_user
    )
    log_event(
        logger,
        "orders_reconcile_requested",
        category="orders",
        event_type="reconcile",
        user_id=current_user.id,
        action="reconcile",
        status="ok",
        details={
            "updated": updated,
            "brokers_with_errors": sorted(list(broker_errors.keys())),
        },
    )
    if broker_errors:
        brokers = ", ".join(sorted(broker_errors.keys()))
        return {
            "status": "ok",
            "message": f"Reconciled {updated} orders (broker warnings: {brokers})",
        }
    return {"status": "ok", "message": f"Reconciled {updated} orders"}
