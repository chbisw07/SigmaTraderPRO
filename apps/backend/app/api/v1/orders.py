from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.brokers.angel_client import AngelOrderError
from app.brokers.zerodha_client import ZerodhaOrderError
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.models.user import User
from app.orders.types import OrderStatus, OrderType
from app.schemas.instrument import InstrumentOut
from app.schemas.order import (
    FnoOrderCreateRequest,
    FnoOrderCreateResponse,
    FnoOrderPreviewRequest,
    FnoOrderPreviewResponse,
    StockOrderCreateRequest,
    StockOrderCreateResponse,
    StockOrderPreviewRequest,
    StockOrderPreviewResponse,
)
from app.services.order_service import (
    OrderDependencyError,
    OrderValidationError,
    order_service,
)

router = APIRouter(prefix="/orders", tags=["orders"])
logger = get_logger(__name__)


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
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    try:
        order, result = order_service.place_stock_order(
            db,
            user=current_user,
            preview=preview,
        )
    except OrderDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (AngelOrderError, ZerodhaOrderError) as exc:
        # Broker-side rejection (market closed, invalid price, insufficient funds, etc.)
        log_event(
            logger,
            "order_rejected",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="rejected",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
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

    log_event(
        logger,
        "order_created",
        category="orders",
        event_type="create",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=payload.canonical_id,
        action="create",
        status="ok",
        order_id=order.id,
        broker_order_id=result.broker_order_id,
    )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="create",
            message="order_created",
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=payload.canonical_id,
            action="create",
            status="ok",
            details={
                "order_id": order.id,
                "broker_order_id": result.broker_order_id,
                "side": payload.side.value,
                "quantity": payload.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
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
        status=OrderStatus.SUBMITTED,
        broker_order_id=result.broker_order_id,
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
        )
    except OrderValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    try:
        order, result = order_service.place_fno_order(
            db,
            user=current_user,
            preview=preview,
        )
    except OrderDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (AngelOrderError, ZerodhaOrderError) as exc:
        log_event(
            logger,
            "order_rejected",
            category="orders",
            event_type="create",
            user_id=current_user.id,
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create",
            status="rejected",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
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

    log_event(
        logger,
        "order_created",
        category="orders",
        event_type="create",
        user_id=current_user.id,
        broker=payload.broker.value,
        instrument_key=preview.instrument.canonical_id,
        action="create",
        status="ok",
        order_id=order.id,
        broker_order_id=result.broker_order_id,
    )

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="orders",
            event_type="create",
            message="order_created_fno",
            user_id=str(current_user.id),
            broker=payload.broker.value,
            instrument_key=preview.instrument.canonical_id,
            action="create",
            status="ok",
            details={
                "order_id": order.id,
                "broker_order_id": result.broker_order_id,
                "side": payload.side.value,
                "lots": payload.lots,
                "quantity": preview.request.quantity,
                "product": payload.product.value,
                "order_type": payload.order_type.value,
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
        status=OrderStatus.SUBMITTED,
        broker_order_id=result.broker_order_id,
        preview=preview_response,
    )
