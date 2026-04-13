from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.schemas.webhook_tradingview import TradingViewWebhookResponse
from app.services.system_events_service import SystemEventLevel, system_events_service
from app.services.webhook_ingestion_service import webhook_ingestion_service

router = APIRouter(tags=["webhooks"])
logger = get_logger(__name__)


@router.post("/webhook/tradingview", response_model=TradingViewWebhookResponse)
async def tradingview(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    correlation_id = str(uuid4())
    audit = getattr(request.app.state, "csv_audit", None)
    raw_text = ""
    try:
        raw = await request.body()
        raw_text = raw.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        system_events_service.emit(
            db,
            level=SystemEventLevel.WARNING,
            category="webhook_tradingview",
            message="TradingView webhook rejected: unreadable request body",
            correlation_id=correlation_id,
        )
        row = webhook_ingestion_service.persist_invalid_tradingview(
            db,
            correlation_id=correlation_id,
            raw_text="",
            reason_code="WEBHOOK_INVALID_PAYLOAD",
            reason_message="Unreadable request body",
        )
        if audit:
            audit.log(
                level="WARNING",
                module=__name__,
                category="webhook_tradingview",
                event_type="ingest",
                message="tradingview_webhook_rejected_unreadable_body",
                correlation_id=correlation_id,
                action="ingest",
                status="rejected",
                details={
                    "reason_code": "WEBHOOK_INVALID_PAYLOAD",
                    "ingestion_id": row.id if row else None,
                    "idempotency_key": row.idempotency_key if row else None,
                },
            )
        return JSONResponse(
            status_code=400,
            content=TradingViewWebhookResponse(
                ok=False,
                status="rejected",
                reason_code="WEBHOOK_INVALID_PAYLOAD",
                message="Unreadable request body",
                correlation_id=correlation_id,
                idempotency_key=(row.idempotency_key if row else None),
                ingestion_id=(row.id if row else None),
            ).model_dump(),
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        system_events_service.emit(
            db,
            level=SystemEventLevel.WARNING,
            category="webhook_tradingview",
            message="TradingView webhook rejected: invalid JSON",
            correlation_id=correlation_id,
        )
        row = webhook_ingestion_service.persist_invalid_tradingview(
            db,
            correlation_id=correlation_id,
            raw_text=raw_text[:50_000],
            reason_code="WEBHOOK_INVALID_PAYLOAD",
            reason_message="Invalid JSON payload",
        )
        log_event(
            logger,
            "tradingview_webhook_rejected",
            category="webhook",
            event_type="tradingview",
            correlation_id=correlation_id,
            status="rejected",
            reason_code="WEBHOOK_INVALID_PAYLOAD",
        )
        if audit:
            audit.log(
                level="WARNING",
                module=__name__,
                category="webhook_tradingview",
                event_type="ingest",
                message="tradingview_webhook_rejected_invalid_json",
                correlation_id=correlation_id,
                action="ingest",
                status="rejected",
                details={
                    "reason_code": "WEBHOOK_INVALID_PAYLOAD",
                    "ingestion_id": row.id if row else None,
                    "idempotency_key": row.idempotency_key if row else None,
                },
            )
        return JSONResponse(
            status_code=400,
            content=TradingViewWebhookResponse(
                ok=False,
                status="rejected",
                reason_code="WEBHOOK_INVALID_PAYLOAD",
                message="Invalid JSON payload",
                correlation_id=correlation_id,
                idempotency_key=(row.idempotency_key if row else None),
                ingestion_id=(row.id if row else None),
            ).model_dump(),
        )

    if not isinstance(body, dict):
        system_events_service.emit(
            db,
            level=SystemEventLevel.WARNING,
            category="webhook_tradingview",
            message="TradingView webhook rejected: payload must be JSON object",
            correlation_id=correlation_id,
        )
        row = webhook_ingestion_service.persist_invalid_tradingview(
            db,
            correlation_id=correlation_id,
            raw_text=raw_text[:50_000],
            reason_code="WEBHOOK_INVALID_PAYLOAD",
            reason_message="Payload must be a JSON object",
        )
        if audit:
            audit.log(
                level="WARNING",
                module=__name__,
                category="webhook_tradingview",
                event_type="ingest",
                message="tradingview_webhook_rejected_non_object",
                correlation_id=correlation_id,
                action="ingest",
                status="rejected",
                details={
                    "reason_code": "WEBHOOK_INVALID_PAYLOAD",
                    "ingestion_id": row.id if row else None,
                    "idempotency_key": row.idempotency_key if row else None,
                },
            )
        return JSONResponse(
            status_code=400,
            content=TradingViewWebhookResponse(
                ok=False,
                status="rejected",
                reason_code="WEBHOOK_INVALID_PAYLOAD",
                message="Payload must be a JSON object",
                correlation_id=correlation_id,
                idempotency_key=(row.idempotency_key if row else None),
                ingestion_id=(row.id if row else None),
            ).model_dump(),
        )

    result = webhook_ingestion_service.ingest_tradingview(
        db, payload=body, correlation_id=correlation_id
    )
    if audit:
        resp = result.response
        audit.log(
            level="INFO" if resp.ok else "WARNING",
            module=__name__,
            category="webhook_tradingview",
            event_type="ingest",
            message=f"tradingview_webhook_{resp.status}",
            correlation_id=resp.correlation_id,
            action="ingest",
            status=str(resp.status),
            details={
                "ok": resp.ok,
                "reason_code": resp.reason_code,
                "duplicate_ignored": getattr(resp, "duplicate_ignored", False),
                "idempotency_key": resp.idempotency_key,
                "ingestion_id": resp.ingestion_id,
                "queue_item_id": getattr(resp, "queue_item_id", None),
                "http_status": result.http_status,
            },
        )
    return JSONResponse(
        status_code=result.http_status,
        content=result.response.model_dump(),
    )
