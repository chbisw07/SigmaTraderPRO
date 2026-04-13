from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logger import get_logger, log_event
from app.models.ingestion_queue_item import IngestionQueueItem
from app.models.user import User
from app.models.webhook_ingestion import WebhookIngestion
from app.schemas.ingestion_queue import QueueSourceType
from app.schemas.webhook_tradingview import (
    TradingViewNormalizedPayload,
    TradingViewWebhookResponse,
)
from app.services.ingestion_queue_service import ingestion_queue_service
from app.services.system_events_service import SystemEventLevel, system_events_service
from app.services.tradingview_webhook_service import (
    TradingViewWebhookReasonCode,
    TradingViewWebhookStatus,
    derive_idempotency_key,
    normalize_payload,
    redact_payload,
    validate_schema_version,
)
from app.services.webhook_routes_service import webhook_routes_service

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class TradingViewIngestionResult:
    response: TradingViewWebhookResponse
    http_status: int
    ingestion: WebhookIngestion | None


class WebhookIngestionService:
    def persist_invalid_tradingview(
        self,
        db: Session,
        *,
        correlation_id: str,
        raw_text: str,
        reason_code: str,
        reason_message: str,
    ) -> WebhookIngestion | None:
        source = "tradingview"
        schema_version = "unknown"
        idem = derive_idempotency_key(
            {"_raw": raw_text, "schema_version": schema_version},
            schema_version=schema_version,
            namespace="tv_rej_json",
        )
        return self._persist(
            db,
            source=source,
            correlation_id=correlation_id,
            schema_version=schema_version,
            idempotency_key=idem,
            status=TradingViewWebhookStatus.REJECTED,
            reason_code=reason_code,
            reason_message=reason_message,
            http_status=status.HTTP_400_BAD_REQUEST,
            raw_payload={"_raw": raw_text},
            normalized=None,
        )

    def ingest_tradingview(
        self,
        db: Session,
        *,
        payload: dict[str, Any],
        correlation_id: str | None = None,
    ) -> TradingViewIngestionResult:
        correlation_id = correlation_id or str(uuid4())
        source = "tradingview"

        schema_version, schema_err = validate_schema_version(payload)
        if schema_err:
            unknown = "unknown"
            idem = derive_idempotency_key(
                payload,
                schema_version=unknown,
                namespace=(
                    "tv_rej_schema_missing"
                    if schema_err
                    == TradingViewWebhookReasonCode.WEBHOOK_SCHEMA_VERSION_MISSING
                    else "tv_rej_schema_unsupported"
                ),
            )
            msg = (
                "TradingView webhook rejected: schema_version missing"
                if schema_err
                == TradingViewWebhookReasonCode.WEBHOOK_SCHEMA_VERSION_MISSING
                else "TradingView webhook rejected: unsupported schema_version"
            )
            ingestion = self._persist(
                db,
                source=source,
                correlation_id=correlation_id,
                schema_version=unknown,
                idempotency_key=idem,
                status=TradingViewWebhookStatus.REJECTED,
                reason_code=schema_err,
                reason_message=msg,
                http_status=status.HTTP_400_BAD_REQUEST,
                raw_payload=payload,
                normalized=None,
            )
            corr = ingestion.correlation_id if ingestion else correlation_id
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="webhook_tradingview",
                message=msg,
                correlation_id=corr,
                metadata={
                    "reason_code": schema_err,
                    "ingestion_id": ingestion.id if ingestion else None,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.REJECTED,
                    reason_code=schema_err,
                    message=msg,
                    correlation_id=corr,
                    idempotency_key=idem,
                    ingestion_id=ingestion.id if ingestion else None,
                ),
                http_status=status.HTTP_400_BAD_REQUEST,
                ingestion=ingestion,
            )

        token = str(payload.get("route_token") or "").strip()
        if not token:
            token_err = TradingViewWebhookReasonCode.WEBHOOK_TOKEN_MISSING
            msg = "TradingView webhook rejected: route_token missing"
            http_status = status.HTTP_401_UNAUTHORIZED
            idem = derive_idempotency_key(
                payload, schema_version=schema_version, namespace="tv_rej_token_missing"
            )
            ingestion = self._persist(
                db,
                source=source,
                correlation_id=correlation_id,
                schema_version=schema_version,
                idempotency_key=idem,
                status=TradingViewWebhookStatus.REJECTED,
                reason_code=token_err,
                reason_message=msg,
                http_status=http_status,
                raw_payload=payload,
                normalized=None,
            )
            corr = ingestion.correlation_id if ingestion else correlation_id
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="webhook_tradingview",
                message=msg,
                correlation_id=corr,
                metadata={
                    "reason_code": token_err,
                    "ingestion_id": ingestion.id if ingestion else None,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.REJECTED,
                    reason_code=token_err,
                    message=msg,
                    correlation_id=corr,
                    idempotency_key=idem,
                    ingestion_id=ingestion.id if ingestion else None,
                ),
                http_status=http_status,
                ingestion=ingestion,
            )

        resolved_route = webhook_routes_service.resolve_tradingview_token(
            db, token=token
        )
        if not resolved_route:
            token_err = TradingViewWebhookReasonCode.WEBHOOK_TOKEN_INVALID
            msg = "TradingView webhook rejected: invalid route_token"
            http_status = status.HTTP_403_FORBIDDEN
            idem = derive_idempotency_key(
                payload, schema_version=schema_version, namespace="tv_rej_token_invalid"
            )
            ingestion = self._persist(
                db,
                source=source,
                correlation_id=correlation_id,
                schema_version=schema_version,
                idempotency_key=idem,
                status=TradingViewWebhookStatus.REJECTED,
                reason_code=token_err,
                reason_message=msg,
                http_status=http_status,
                raw_payload=payload,
                normalized=None,
            )
            corr = ingestion.correlation_id if ingestion else correlation_id
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="webhook_tradingview",
                message=msg,
                correlation_id=corr,
                metadata={
                    "reason_code": token_err,
                    "ingestion_id": ingestion.id if ingestion else None,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.REJECTED,
                    reason_code=token_err,
                    message=msg,
                    correlation_id=corr,
                    idempotency_key=idem,
                    ingestion_id=ingestion.id if ingestion else None,
                ),
                http_status=http_status,
                ingestion=ingestion,
            )

        idempotency_key = derive_idempotency_key(payload, schema_version=schema_version)

        existing = (
            db.query(WebhookIngestion)
            .filter(WebhookIngestion.idempotency_key == idempotency_key)
            .one_or_none()
        )
        if existing:
            system_events_service.emit(
                db,
                level=SystemEventLevel.INFO,
                category="webhook_tradingview",
                message="TradingView webhook duplicate ignored",
                correlation_id=existing.correlation_id,
                metadata={
                    "idempotency_key": idempotency_key,
                    "ingestion_id": existing.id,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=True,
                    status=TradingViewWebhookStatus.DUPLICATE_IGNORED,
                    reason_code=TradingViewWebhookReasonCode.WEBHOOK_DUPLICATE,
                    message="Duplicate webhook ignored",
                    correlation_id=existing.correlation_id,
                    idempotency_key=idempotency_key,
                    duplicate_ignored=True,
                    ingestion_id=existing.id,
                    queue_item_id=_find_queue_item_id(
                        db,
                        user_id=resolved_route.user_id,
                        idempotency_key=idempotency_key,
                    ),
                ),
                http_status=status.HTTP_200_OK,
                ingestion=existing,
            )

        norm = normalize_payload(
            payload, schema_version=schema_version, idempotency_key=idempotency_key
        )
        if not norm.normalized:
            msg = (
                f"TradingView webhook rejected: "
                f"{norm.reason_message or 'invalid payload'}"
            )
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="webhook_tradingview",
                message=msg,
                correlation_id=correlation_id,
                metadata={"reason_code": norm.reason_code},
            )
            ingestion = self._persist(
                db,
                source=source,
                correlation_id=correlation_id,
                schema_version=schema_version,
                idempotency_key=derive_idempotency_key(
                    payload, schema_version=schema_version, namespace="tv_rej_payload"
                ),
                status=TradingViewWebhookStatus.REJECTED,
                reason_code=norm.reason_code,
                reason_message=norm.reason_message,
                http_status=status.HTTP_400_BAD_REQUEST,
                raw_payload=payload,
                normalized=None,
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.REJECTED,
                    reason_code=norm.reason_code,
                    message=msg,
                    correlation_id=correlation_id,
                    idempotency_key=(ingestion.idempotency_key if ingestion else None),
                    ingestion_id=ingestion.id if ingestion else None,
                ),
                http_status=status.HTTP_400_BAD_REQUEST,
                ingestion=ingestion,
            )

        normalized: TradingViewNormalizedPayload = norm.normalized

        ingestion = self._persist(
            db,
            source=source,
            correlation_id=correlation_id,
            schema_version=schema_version,
            idempotency_key=idempotency_key,
            status=TradingViewWebhookStatus.ACCEPTED,
            reason_code=None,
            reason_message=None,
            http_status=status.HTTP_200_OK,
            raw_payload=payload,
            normalized=normalized,
        )

        if ingestion and ingestion.correlation_id != correlation_id:
            system_events_service.emit(
                db,
                level=SystemEventLevel.INFO,
                category="webhook_tradingview",
                message="TradingView webhook duplicate ignored",
                correlation_id=ingestion.correlation_id,
                metadata={
                    "idempotency_key": idempotency_key,
                    "ingestion_id": ingestion.id,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=True,
                    status=TradingViewWebhookStatus.DUPLICATE_IGNORED,
                    reason_code=TradingViewWebhookReasonCode.WEBHOOK_DUPLICATE,
                    message="Duplicate webhook ignored",
                    correlation_id=ingestion.correlation_id,
                    idempotency_key=idempotency_key,
                    duplicate_ignored=True,
                    ingestion_id=ingestion.id,
                    queue_item_id=_find_queue_item_id(
                        db,
                        user_id=resolved_route.user_id,
                        idempotency_key=idempotency_key,
                    ),
                ),
                http_status=status.HTTP_200_OK,
                ingestion=ingestion,
            )

        queue_item_id: int | None = None
        try:
            user = (
                db.query(User).filter(User.id == resolved_route.user_id).one_or_none()
            )
            if user:
                queue_intent = _build_queue_intent_from_tradingview(
                    normalized,
                    default_broker_key=resolved_route.default_broker_key,
                    default_product=resolved_route.default_product,
                    default_order_type=resolved_route.default_order_type,
                )
                qitem = ingestion_queue_service.create_item(
                    db,
                    user=user,
                    source_type=QueueSourceType.tradingview,
                    source_ref=f"ingestion:{ingestion.id}" if ingestion else None,
                    execution_mode=resolved_route.default_execution_mode,
                    correlation_id=correlation_id,
                    idempotency_key=idempotency_key,
                    intent_json=queue_intent,
                    notes=None,
                    expires_at=None,
                    default_broker_key=resolved_route.default_broker_key,
                    default_product=resolved_route.default_product,
                    default_order_type=resolved_route.default_order_type,
                )
                queue_item_id = qitem.id
                system_events_service.emit(
                    db,
                    level=SystemEventLevel.INFO,
                    category="webhook_tradingview",
                    message="TradingView webhook enqueued",
                    correlation_id=correlation_id,
                    user_id=user.id,
                    broker=qitem.broker_key,
                    symbol=normalized.symbol,
                    metadata={
                        "queue_id": qitem.id,
                        "ingestion_id": ingestion.id if ingestion else None,
                        "execution_mode": qitem.execution_mode,
                        "resolution_state": qitem.resolution_state,
                    },
                )
        except Exception:  # noqa: BLE001
            # Never fail ingestion response due to queue admission issues.
            queue_item_id = None

        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="webhook_tradingview",
            message="TradingView webhook received",
            correlation_id=correlation_id,
            metadata={
                "source": source,
                "schema_version": schema_version,
                "idempotency_key": idempotency_key,
                "ingestion_id": ingestion.id if ingestion else None,
                "queue_item_id": queue_item_id,
            },
        )
        log_event(
            logger,
            "tradingview_webhook_received",
            category="webhook",
            event_type="tradingview",
            correlation_id=correlation_id,
            idempotency_key=idempotency_key,
            schema_version=schema_version,
            ingestion_id=ingestion.id if ingestion else None,
            status="received",
        )

        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="webhook_tradingview",
            message="TradingView webhook accepted",
            correlation_id=correlation_id,
            metadata={
                "schema_version": schema_version,
                "idempotency_key": idempotency_key,
                "ingestion_id": ingestion.id if ingestion else None,
                "symbol": normalized.symbol,
                "exchange": normalized.exchange,
                "strategy_id": normalized.strategy_id,
                "queue_item_id": queue_item_id,
            },
        )
        log_event(
            logger,
            "tradingview_webhook_accepted",
            category="webhook",
            event_type="tradingview",
            correlation_id=correlation_id,
            idempotency_key=idempotency_key,
            schema_version=schema_version,
            status="accepted",
        )

        return TradingViewIngestionResult(
            response=TradingViewWebhookResponse(
                ok=True,
                status=TradingViewWebhookStatus.ACCEPTED,
                reason_code=None,
                message="Webhook accepted",
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
                ingestion_id=ingestion.id if ingestion else None,
                queue_item_id=queue_item_id,
            ),
            http_status=status.HTTP_200_OK,
            ingestion=ingestion,
        )

    def _persist(
        self,
        db: Session,
        *,
        source: str,
        correlation_id: str,
        schema_version: str,
        idempotency_key: str,
        status: str,
        reason_code: str | None,
        reason_message: str | None,
        http_status: int,
        raw_payload: dict[str, Any],
        normalized: TradingViewNormalizedPayload | None,
    ) -> WebhookIngestion | None:
        raw = redact_payload(raw_payload)
        normalized_json = normalized.model_dump() if normalized else None
        try:
            row = WebhookIngestion(
                source=source,
                correlation_id=correlation_id,
                schema_version=str(schema_version),
                idempotency_key=idempotency_key,
                status=status,
                reason_code=reason_code,
                reason_message=reason_message,
                http_status=int(http_status),
                raw_payload_json=raw,
                normalized_payload_json=normalized_json,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        except IntegrityError:
            db.rollback()
            existing = (
                db.query(WebhookIngestion)
                .filter(WebhookIngestion.idempotency_key == idempotency_key)
                .one_or_none()
            )
            return existing
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            log_event(
                logger,
                "webhook_ingestion_persist_failed",
                level=logging.ERROR,
                category="webhook",
                event_type="persist",
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
                error=str(exc),
            )
            return None


webhook_ingestion_service = WebhookIngestionService()


def _find_queue_item_id(
    db: Session, *, user_id: int, idempotency_key: str
) -> int | None:
    row = (
        db.query(IngestionQueueItem)
        .filter(IngestionQueueItem.user_id == user_id)
        .filter(IngestionQueueItem.idempotency_key == idempotency_key)
        .one_or_none()
    )
    return row.id if row else None


def _build_queue_intent_from_tradingview(
    normalized: TradingViewNormalizedPayload,
    *,
    default_broker_key: str | None,
    default_product: str | None,
    default_order_type: str | None,
) -> dict[str, Any]:
    side = str(normalized.side or "").strip().upper() or None
    order_type = (
        str((normalized.order_type or default_order_type) or "").strip().upper() or None
    )
    product = str((normalized.product or default_product) or "").strip().upper() or None

    intent: dict[str, Any] = {
        "version": "1",
        "entry": {
            "broker": default_broker_key,
            "canonical_id": None,
            "side": side,
            "product_mode": None,
            "product": product,
            "order_type": order_type,
            "limit_price": None,
            "quantity": normalized.quantity,
            "lots": normalized.lots,
            "lot_size": normalized.lot_size,
            "instrument_hint": {
                "symbol": normalized.symbol,
                "exchange": normalized.exchange,
                "instrument_type": normalized.instrument_type,
                "underlying": normalized.underlying,
                "expiry": normalized.expiry,
                "strike": normalized.strike,
                "option_type": normalized.option_type,
            },
        },
        "plan": {
            "managed_exits": False,
            "reference_price": None,
            "reference_source": None,
            "stop_loss": {"price": None, "pct": None},
            "target": {"price": None, "pct": None},
            "trailing_sl": {"enabled": False, "distance": {"price": None, "pct": None}},
        },
        "source_context": "tradingview",
    }

    if order_type == "LIMIT":
        intent["entry"]["limit_price"] = normalized.price

    # Amount-only payloads are admitted but remain execution-unready until the
    # operator resolves quantity (or a future sizing policy is implemented).
    if normalized.quantity is None and normalized.amount is not None:
        intent["entry"]["amount"] = float(normalized.amount)

    return intent
