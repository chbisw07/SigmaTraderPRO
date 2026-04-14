from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.schemas.ingestion_queue import (
    IngestionQueueCreateRequest,
    IngestionQueueItemOut,
    IngestionQueueListResponse,
    IngestionQueueResolveRequest,
    IngestionQueueUpdateRequest,
    QueueExecutionMode,
    QueueSourceType,
    QueueStatus,
    QueueValidationState,
)
from app.schemas.instrument import InstrumentOut
from app.services.ingestion_queue_service import QueueError, ingestion_queue_service
from app.services.instrument_registry_service import instrument_registry_service

router = APIRouter(prefix="/queue", tags=["queue"])
logger = get_logger(__name__)


def _item_out(item, inst) -> IngestionQueueItemOut:
    intent = item.execution_intent_json
    entry = intent.get("entry", {})
    plan = intent.get("plan", {})
    return IngestionQueueItemOut(
        id=item.id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        source_type=QueueSourceType(item.source_type),
        source_ref=item.source_ref,
        correlation_id=item.correlation_id,
        idempotency_key=item.idempotency_key,
        broker=item.broker_key,
        canonical_id=item.canonical_id,
        instrument=(
            InstrumentOut.model_validate(inst, from_attributes=True) if inst else None
        ),
        side=entry.get("side"),
        quantity=entry.get("quantity"),
        lots=entry.get("lots"),
        product=entry.get("product"),
        order_type=entry.get("order_type"),
        limit_price=entry.get("limit_price"),
        managed_exits=bool(plan.get("managed_exits") or False),
        execution_mode=QueueExecutionMode(item.execution_mode),
        status=QueueStatus(item.status),
        validation_state=QueueValidationState(item.validation_state),
        block_reason_code=item.block_reason_code,
        block_reason_message=item.block_reason_message,
        resolution_state=item.resolution_state or "resolved",
        resolution=item.resolution_json or {},
        source_route_id=getattr(item, "source_route_id", None),
        strategy_id=getattr(item, "strategy_id", None),
        strategy_name=getattr(item, "strategy_name", None),
        strategy_params_json=getattr(item, "strategy_params_json", None),
        signal_price=getattr(item, "signal_price", None),
        timeframe=getattr(item, "timeframe", None),
        signal_timestamp=getattr(item, "signal_timestamp", None),
        dispatched_order_id=item.dispatched_order_id,
        notes=item.notes,
        expires_at=item.expires_at,
        execution_intent=intent,
    )


@router.post("", response_model=IngestionQueueItemOut)
def create_queue_item(
    payload: IngestionQueueCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueItemOut:
    correlation_id = payload.correlation_id or str(uuid4())
    log_event(
        logger,
        "queue_create",
        category="ingestion_queue",
        event_type="create",
        user_id=current_user.id,
        correlation_id=correlation_id,
        status="started",
        source_type=payload.source_type.value,
    )
    try:
        item = ingestion_queue_service.create_item(
            db,
            user=current_user,
            source_type=payload.source_type,
            source_ref=payload.source_ref,
            execution_mode=payload.execution_mode,
            correlation_id=correlation_id,
            idempotency_key=payload.idempotency_key,
            intent_json=payload.execution_intent,
            notes=payload.notes,
            expires_at=payload.expires_at,
        )
    except QueueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="ingestion_queue",
            event_type="queue_created",
            message="queue_created",
            user_id=str(current_user.id),
            broker=item.broker_key,
            instrument_key=item.canonical_id,
            action="create",
            status=item.status,
            correlation_id=item.correlation_id,
            details={
                "queue_id": item.id,
                "source_type": item.source_type,
                "execution_mode": item.execution_mode,
            },
        )
        if payload.execution_mode == QueueExecutionMode.auto_dispatch:
            audit.log(
                level="INFO" if item.status == QueueStatus.dispatched else "WARNING",
                module=__name__,
                category="ingestion_queue",
                event_type="queue_auto_dispatch_result",
                message="queue_auto_dispatch_result",
                user_id=str(current_user.id),
                broker=item.broker_key,
                instrument_key=item.canonical_id,
                action="auto_dispatch",
                status=item.status,
                correlation_id=item.correlation_id,
                details={
                    "queue_id": item.id,
                    "order_id": item.dispatched_order_id,
                    "block_reason_code": item.block_reason_code,
                },
            )

    inst = instrument_registry_service.get_by_canonical_id(db, item.canonical_id)
    return _item_out(item, inst)


@router.get("", response_model=IngestionQueueListResponse)
def list_queue_items(
    status_filter: str | None = Query(default=None, alias="status"),
    resolution_state: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    broker: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueListResponse:
    rows = ingestion_queue_service.list_items(
        db,
        user=current_user,
        status=status_filter,
        resolution_state=resolution_state,
        source_type=source_type,
        broker=broker,
        q=q,
        limit=limit,
    )
    items = [_item_out(item, inst) for item, inst in rows]
    return IngestionQueueListResponse(
        items=items,
        meta={
            "limit": limit,
        },
    )


@router.patch("/{item_id}", response_model=IngestionQueueItemOut)
def update_queue_item(
    item_id: int,
    payload: IngestionQueueUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueItemOut:
    try:
        item = ingestion_queue_service.update_item(
            db,
            user=current_user,
            item_id=item_id,
            execution_mode=payload.execution_mode,
            intent_json=payload.execution_intent,
            notes=payload.notes,
            expires_at=payload.expires_at,
        )
    except QueueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    inst = instrument_registry_service.get_by_canonical_id(db, item.canonical_id)

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="ingestion_queue",
            event_type="queue_updated",
            message="queue_updated",
            user_id=str(current_user.id),
            broker=item.broker_key,
            instrument_key=item.canonical_id,
            action="update",
            status=item.status,
            correlation_id=item.correlation_id,
            details={"queue_id": item.id},
        )
    return _item_out(item, inst)


@router.post("/{item_id}/execute", response_model=IngestionQueueItemOut)
def execute_queue_item(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueItemOut:
    try:
        item = ingestion_queue_service.execute_item(
            db, user=current_user, item_id=item_id
        )
    except QueueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="ingestion_queue",
            event_type="queue_executed",
            message="queue_executed",
            user_id=str(current_user.id),
            broker=item.broker_key,
            instrument_key=item.canonical_id,
            action="execute",
            status=item.status,
            correlation_id=item.correlation_id,
            details={"queue_id": item.id, "order_id": item.dispatched_order_id},
        )
    inst = instrument_registry_service.get_by_canonical_id(db, item.canonical_id)
    return _item_out(item, inst)


@router.post("/{item_id}/cancel", response_model=IngestionQueueItemOut)
def cancel_queue_item(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueItemOut:
    try:
        item = ingestion_queue_service.cancel_item(
            db, user=current_user, item_id=item_id
        )
    except QueueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="ingestion_queue",
            event_type="queue_cancelled",
            message="queue_cancelled",
            user_id=str(current_user.id),
            broker=item.broker_key,
            instrument_key=item.canonical_id,
            action="cancel",
            status=item.status,
            correlation_id=item.correlation_id,
            details={"queue_id": item.id},
        )

    inst = instrument_registry_service.get_by_canonical_id(db, item.canonical_id)
    return _item_out(item, inst)


@router.post("/{item_id}/resolve", response_model=IngestionQueueItemOut)
def resolve_queue_item(
    item_id: int,
    payload: IngestionQueueResolveRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> IngestionQueueItemOut:
    try:
        item = ingestion_queue_service.resolve_item_fields(
            db,
            user=current_user,
            item_id=item_id,
            broker=payload.broker,
            canonical_id=payload.canonical_id,
            product=payload.product,
            order_type=payload.order_type,
            quantity=payload.quantity,
            limit_price=payload.limit_price,
            instrument_hint=payload.instrument_hint,
        )
    except QueueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="ingestion_queue",
            event_type="queue_resolved",
            message="queue_resolved",
            user_id=str(current_user.id),
            broker=item.broker_key,
            instrument_key=item.canonical_id,
            action="resolve",
            status=item.status,
            correlation_id=item.correlation_id,
            details={"queue_id": item.id},
        )

    inst = instrument_registry_service.get_by_canonical_id(db, item.canonical_id)
    return _item_out(item, inst)
