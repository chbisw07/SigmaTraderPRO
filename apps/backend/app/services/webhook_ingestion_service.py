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

        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="webhook_tradingview",
            message="TradingView route resolved",
            correlation_id=correlation_id,
            user_id=resolved_route.user_id,
            metadata={
                "source": "tradingview",
                "route_id": resolved_route.route_id,
                "route_name": resolved_route.name,
                "default_broker_key": resolved_route.default_broker_key,
                "default_execution_mode": resolved_route.default_execution_mode.value,
                "has_policy": bool(resolved_route.policy_json),
            },
        )

        idempotency_key = derive_idempotency_key(payload, schema_version=schema_version)

        existing = (
            db.query(WebhookIngestion)
            .filter(WebhookIngestion.idempotency_key == idempotency_key)
            .one_or_none()
        )
        if existing:
            corr = existing.correlation_id
            existing_queue_id = _find_queue_item_id(
                db, user_id=resolved_route.user_id, idempotency_key=idempotency_key
            )
            if existing_queue_id:
                system_events_service.emit(
                    db,
                    level=SystemEventLevel.INFO,
                    category="webhook_tradingview",
                    message="TradingView webhook duplicate ignored",
                    correlation_id=corr,
                    metadata={
                        "idempotency_key": idempotency_key,
                        "ingestion_id": existing.id,
                        "queue_item_id": existing_queue_id,
                    },
                )
                return TradingViewIngestionResult(
                    response=TradingViewWebhookResponse(
                        ok=True,
                        status=TradingViewWebhookStatus.DUPLICATE_IGNORED,
                        reason_code=TradingViewWebhookReasonCode.WEBHOOK_DUPLICATE,
                        message="Duplicate webhook ignored",
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        duplicate_ignored=True,
                        ingestion_id=existing.id,
                        queue_item_id=existing_queue_id,
                    ),
                    http_status=status.HTTP_200_OK,
                    ingestion=existing,
                )

            # If an ingestion row exists but a queue item does not, attempt queue
            # admission again.
            normalized_existing: TradingViewNormalizedPayload | None = None
            try:
                if isinstance(existing.normalized_payload_json, dict):
                    normalized_existing = TradingViewNormalizedPayload.model_validate(
                        existing.normalized_payload_json
                    )
            except Exception:  # noqa: BLE001
                normalized_existing = None

            if not normalized_existing:
                msg = "TradingView webhook accepted but failed to enqueue queue item"
                system_events_service.emit(
                    db,
                    level=SystemEventLevel.ERROR,
                    category="webhook_tradingview",
                    message=msg,
                    correlation_id=corr,
                    user_id=resolved_route.user_id,
                    metadata={
                        "reason_code": (
                            TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED
                        ),
                        "ingestion_id": existing.id,
                        "idempotency_key": idempotency_key,
                        "route_id": resolved_route.route_id,
                        "error": "missing normalized payload for retry",
                        "retry": True,
                    },
                )
                return TradingViewIngestionResult(
                    response=TradingViewWebhookResponse(
                        ok=False,
                        status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                        reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                        message=msg,
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        ingestion_id=existing.id,
                        queue_item_id=None,
                    ),
                    http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    ingestion=existing,
                )

            queue_err: str | None = None
            queue_item_id: int | None = None
            try:
                user = (
                    db.query(User)
                    .filter(User.id == resolved_route.user_id)
                    .one_or_none()
                )
                if not user:
                    queue_err = "User not found for resolved route"
                else:
                    queue_intent = _build_queue_intent_from_tradingview(
                        normalized_existing,
                        default_broker_key=resolved_route.default_broker_key,
                        default_product=resolved_route.default_product,
                        default_order_type=resolved_route.default_order_type,
                        route_policy=resolved_route.policy_json,
                    )
                    source_metadata = {
                        "strategy_id": normalized_existing.strategy_id,
                        "strategy_name": normalized_existing.strategy_name,
                        "strategy_params_json": (
                            normalized_existing.strategy_params_json
                        ),
                        "signal_price": normalized_existing.price,
                        "timeframe": normalized_existing.timeframe,
                        "signal_timestamp": normalized_existing.alert_timestamp,
                        "route_name": resolved_route.name,
                    }
                    qitem = ingestion_queue_service.create_item(
                        db,
                        user=user,
                        source_type=QueueSourceType.tradingview,
                        source_ref=f"ingestion:{existing.id}",
                        execution_mode=resolved_route.default_execution_mode,
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        intent_json=queue_intent,
                        notes=None,
                        expires_at=None,
                        default_broker_key=resolved_route.default_broker_key,
                        default_product=resolved_route.default_product,
                        default_order_type=resolved_route.default_order_type,
                        source_route_id=resolved_route.route_id,
                        source_policy_json=resolved_route.policy_json,
                        source_metadata_json=source_metadata,
                        strategy_id=normalized_existing.strategy_id,
                        strategy_name=normalized_existing.strategy_name,
                        strategy_params_json=normalized_existing.strategy_params_json,
                        signal_price=normalized_existing.price,
                        timeframe=normalized_existing.timeframe,
                        signal_timestamp=normalized_existing.alert_timestamp,
                    )
                    queue_item_id = qitem.id
                    system_events_service.emit(
                        db,
                        level=SystemEventLevel.INFO,
                        category="webhook_tradingview",
                        message="TradingView webhook enqueued",
                        correlation_id=corr,
                        user_id=user.id,
                        broker=qitem.broker_key,
                        symbol=normalized_existing.symbol,
                        metadata={
                            "queue_id": qitem.id,
                            "ingestion_id": existing.id,
                            "execution_mode": qitem.execution_mode,
                            "resolution_state": qitem.resolution_state,
                            "retry": True,
                        },
                    )
            except Exception as exc:  # noqa: BLE001
                queue_err = str(exc)

            if not queue_err and queue_item_id:
                return TradingViewIngestionResult(
                    response=TradingViewWebhookResponse(
                        ok=True,
                        status=TradingViewWebhookStatus.ACCEPTED,
                        reason_code=None,
                        message="Webhook accepted",
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        ingestion_id=existing.id,
                        queue_item_id=queue_item_id,
                    ),
                    http_status=status.HTTP_200_OK,
                    ingestion=existing,
                )

            msg = "TradingView webhook accepted but failed to enqueue queue item"
            system_events_service.emit(
                db,
                level=SystemEventLevel.ERROR,
                category="webhook_tradingview",
                message=msg,
                correlation_id=corr,
                user_id=resolved_route.user_id,
                metadata={
                    "reason_code": TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    "ingestion_id": existing.id,
                    "idempotency_key": idempotency_key,
                    "route_id": resolved_route.route_id,
                    "error": queue_err,
                    "retry": True,
                },
            )
            log_event(
                logger,
                "tradingview_queue_admission_failed",
                level=logging.ERROR,
                category="webhook",
                event_type="tradingview",
                correlation_id=corr,
                idempotency_key=idempotency_key,
                ingestion_id=existing.id,
                status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                error=queue_err,
            )
            try:
                existing.status = TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED
                existing.reason_code = (
                    TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED
                )
                existing.reason_message = msg
                existing.http_status = status.HTTP_503_SERVICE_UNAVAILABLE
                db.commit()
                db.refresh(existing)
            except Exception:  # noqa: BLE001
                db.rollback()

            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                    reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    message=msg,
                    correlation_id=corr,
                    idempotency_key=idempotency_key,
                    ingestion_id=existing.id,
                    queue_item_id=None,
                ),
                http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
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
            corr = ingestion.correlation_id
            existing_queue_id = _find_queue_item_id(
                db, user_id=resolved_route.user_id, idempotency_key=idempotency_key
            )
            if existing_queue_id:
                system_events_service.emit(
                    db,
                    level=SystemEventLevel.INFO,
                    category="webhook_tradingview",
                    message="TradingView webhook duplicate ignored",
                    correlation_id=corr,
                    metadata={
                        "idempotency_key": idempotency_key,
                        "ingestion_id": ingestion.id,
                        "queue_item_id": existing_queue_id,
                    },
                )
                return TradingViewIngestionResult(
                    response=TradingViewWebhookResponse(
                        ok=True,
                        status=TradingViewWebhookStatus.DUPLICATE_IGNORED,
                        reason_code=TradingViewWebhookReasonCode.WEBHOOK_DUPLICATE,
                        message="Duplicate webhook ignored",
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        duplicate_ignored=True,
                        ingestion_id=ingestion.id,
                        queue_item_id=existing_queue_id,
                    ),
                    http_status=status.HTTP_200_OK,
                    ingestion=ingestion,
                )

            # Attempt queue admission (again) if the ingestion row exists but queue
            # item does not.
            queue_err: str | None = None
            queue_item_id: int | None = None
            try:
                user = (
                    db.query(User)
                    .filter(User.id == resolved_route.user_id)
                    .one_or_none()
                )
                if not user:
                    queue_err = "User not found for resolved route"
                else:
                    queue_intent = _build_queue_intent_from_tradingview(
                        normalized,
                        default_broker_key=resolved_route.default_broker_key,
                        default_product=resolved_route.default_product,
                        default_order_type=resolved_route.default_order_type,
                        route_policy=resolved_route.policy_json,
                    )
                    source_metadata = {
                        "strategy_id": normalized.strategy_id,
                        "strategy_name": normalized.strategy_name,
                        "strategy_params_json": normalized.strategy_params_json,
                        "signal_price": normalized.price,
                        "timeframe": normalized.timeframe,
                        "signal_timestamp": normalized.alert_timestamp,
                        "route_name": resolved_route.name,
                    }
                    qitem = ingestion_queue_service.create_item(
                        db,
                        user=user,
                        source_type=QueueSourceType.tradingview,
                        source_ref=f"ingestion:{ingestion.id}",
                        execution_mode=resolved_route.default_execution_mode,
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        intent_json=queue_intent,
                        notes=None,
                        expires_at=None,
                        default_broker_key=resolved_route.default_broker_key,
                        default_product=resolved_route.default_product,
                        default_order_type=resolved_route.default_order_type,
                        source_route_id=resolved_route.route_id,
                        source_policy_json=resolved_route.policy_json,
                        source_metadata_json=source_metadata,
                        strategy_id=normalized.strategy_id,
                        strategy_name=normalized.strategy_name,
                        strategy_params_json=normalized.strategy_params_json,
                        signal_price=normalized.price,
                        timeframe=normalized.timeframe,
                        signal_timestamp=normalized.alert_timestamp,
                    )
                    queue_item_id = qitem.id
            except Exception as exc:  # noqa: BLE001
                queue_err = str(exc)

            if not queue_err and queue_item_id:
                return TradingViewIngestionResult(
                    response=TradingViewWebhookResponse(
                        ok=True,
                        status=TradingViewWebhookStatus.ACCEPTED,
                        reason_code=None,
                        message="Webhook accepted",
                        correlation_id=corr,
                        idempotency_key=idempotency_key,
                        ingestion_id=ingestion.id,
                        queue_item_id=queue_item_id,
                    ),
                    http_status=status.HTTP_200_OK,
                    ingestion=ingestion,
                )

            msg = "TradingView webhook accepted but failed to enqueue queue item"
            system_events_service.emit(
                db,
                level=SystemEventLevel.ERROR,
                category="webhook_tradingview",
                message=msg,
                correlation_id=corr,
                user_id=resolved_route.user_id,
                metadata={
                    "reason_code": TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    "ingestion_id": ingestion.id,
                    "idempotency_key": idempotency_key,
                    "route_id": resolved_route.route_id,
                    "error": queue_err,
                    "retry": True,
                },
            )
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                    reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    message=msg,
                    correlation_id=corr,
                    idempotency_key=idempotency_key,
                    ingestion_id=ingestion.id,
                    queue_item_id=None,
                ),
                http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
                ingestion=ingestion,
            )

        queue_item_id: int | None = None
        queue_err: str | None = None
        try:
            user = (
                db.query(User).filter(User.id == resolved_route.user_id).one_or_none()
            )
            if not user:
                queue_err = "User not found for resolved route"
            else:
                queue_intent = _build_queue_intent_from_tradingview(
                    normalized,
                    default_broker_key=resolved_route.default_broker_key,
                    default_product=resolved_route.default_product,
                    default_order_type=resolved_route.default_order_type,
                    route_policy=resolved_route.policy_json,
                )
                source_metadata = {
                    "strategy_id": normalized.strategy_id,
                    "strategy_name": normalized.strategy_name,
                    "strategy_params_json": normalized.strategy_params_json,
                    "signal_price": normalized.price,
                    "timeframe": normalized.timeframe,
                    "signal_timestamp": normalized.alert_timestamp,
                    "route_name": resolved_route.name,
                }
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
                    source_route_id=resolved_route.route_id,
                    source_policy_json=resolved_route.policy_json,
                    source_metadata_json=source_metadata,
                    strategy_id=normalized.strategy_id,
                    strategy_name=normalized.strategy_name,
                    strategy_params_json=normalized.strategy_params_json,
                    signal_price=normalized.price,
                    timeframe=normalized.timeframe,
                    signal_timestamp=normalized.alert_timestamp,
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
        except Exception as exc:  # noqa: BLE001
            queue_err = str(exc)

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

        if queue_err or not queue_item_id:
            msg = "TradingView webhook accepted but failed to enqueue queue item"
            system_events_service.emit(
                db,
                level=SystemEventLevel.ERROR,
                category="webhook_tradingview",
                message=msg,
                correlation_id=correlation_id,
                user_id=resolved_route.user_id,
                metadata={
                    "reason_code": TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    "ingestion_id": ingestion.id if ingestion else None,
                    "idempotency_key": idempotency_key,
                    "route_id": resolved_route.route_id,
                    "error": queue_err,
                },
            )
            log_event(
                logger,
                "tradingview_queue_admission_failed",
                level=logging.ERROR,
                category="webhook",
                event_type="tradingview",
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
                ingestion_id=ingestion.id if ingestion else None,
                status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                error=queue_err,
            )
            if ingestion:
                try:
                    ingestion.status = TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED
                    ingestion.reason_code = (
                        TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED
                    )
                    ingestion.reason_message = msg
                    ingestion.http_status = status.HTTP_503_SERVICE_UNAVAILABLE
                    db.commit()
                    db.refresh(ingestion)
                except Exception:  # noqa: BLE001
                    db.rollback()
            return TradingViewIngestionResult(
                response=TradingViewWebhookResponse(
                    ok=False,
                    status=TradingViewWebhookStatus.ACCEPTED_NOT_ENQUEUED,
                    reason_code=TradingViewWebhookReasonCode.QUEUE_ADMISSION_FAILED,
                    message=msg,
                    correlation_id=correlation_id,
                    idempotency_key=idempotency_key,
                    ingestion_id=ingestion.id if ingestion else None,
                    queue_item_id=None,
                ),
                http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
                ingestion=ingestion,
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
    route_policy: dict | None,
) -> dict[str, Any]:
    route_policy = route_policy if isinstance(route_policy, dict) else {}

    allow_payload_product = bool(route_policy.get("allow_payload_product", True))
    allow_payload_order_type = bool(route_policy.get("allow_payload_order_type", True))
    allow_payload_sizing = bool(route_policy.get("allow_payload_sizing", True))
    allow_payload_exits = bool(route_policy.get("allow_payload_exits", True))

    side = str(normalized.side or "").strip().upper() or None
    order_type_raw = normalized.order_type if allow_payload_order_type else None
    order_type = (
        str((order_type_raw or default_order_type) or "").strip().upper() or None
    )
    product_raw = normalized.product if allow_payload_product else None
    product = str((product_raw or default_product) or "").strip().upper() or None

    product_mode_default = str(route_policy.get("product_mode_default") or "").strip()
    product_mode = product_mode_default or None
    if not product and product_mode:
        if product_mode == "delivery":
            product = "CNC"
        elif product_mode == "intraday":
            product = "MIS"
        elif product_mode == "carry_forward":
            product = "NRML"

    intent: dict[str, Any] = {
        "version": "1",
        "entry": {
            "broker": default_broker_key,
            "canonical_id": None,
            "side": side,
            "product_mode": product_mode,
            "product": product,
            "order_type": order_type,
            "limit_price": None,
            "quantity": normalized.quantity if allow_payload_sizing else None,
            "lots": normalized.lots if allow_payload_sizing else None,
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
            "reference_price": normalized.price,
            "reference_source": ("signal_price" if normalized.price else None),
            "stop_loss": {"price": None, "pct": None},
            "target": {"price": None, "pct": None},
            "trailing_sl": {"enabled": False, "distance": {"price": None, "pct": None}},
        },
        "source_context": "tradingview",
    }

    if order_type == "LIMIT":
        intent["entry"]["limit_price"] = normalized.price

    # Sizing: support amount-only payloads and route policy default sizing.
    if intent["entry"]["quantity"] is None:
        if allow_payload_sizing and normalized.amount is not None:
            intent["entry"]["amount"] = float(normalized.amount)
        else:
            sizing_mode = str(route_policy.get("sizing_mode") or "").strip()
            if sizing_mode == "fixed_quantity" and route_policy.get("fixed_quantity"):
                intent["entry"]["quantity"] = int(route_policy["fixed_quantity"])
            elif sizing_mode == "fixed_amount" and route_policy.get("fixed_amount"):
                intent["entry"]["amount"] = float(route_policy["fixed_amount"])

    # Managed exits: payload wins if allowed, else apply route defaults.
    exits_enabled = None
    if allow_payload_exits and isinstance(normalized.managed_exits, bool):
        exits_enabled = normalized.managed_exits
    if exits_enabled is None and route_policy.get("managed_exits_enabled") is not None:
        exits_enabled = bool(route_policy.get("managed_exits_enabled"))
    intent["plan"]["managed_exits"] = bool(exits_enabled or False)

    def _level_from_dict(d: Any) -> dict[str, Any] | None:
        if not isinstance(d, dict):
            return None
        return {"price": d.get("price"), "pct": d.get("pct")}

    if intent["plan"]["managed_exits"]:
        if allow_payload_exits:
            if normalized.stop_loss is not None or normalized.stop_loss_pct is not None:
                intent["plan"]["stop_loss"] = {
                    "price": normalized.stop_loss,
                    "pct": normalized.stop_loss_pct,
                }
            if normalized.target is not None or normalized.target_pct is not None:
                intent["plan"]["target"] = {
                    "price": normalized.target,
                    "pct": normalized.target_pct,
                }
            if (
                normalized.trailing_sl is not None
                or normalized.trailing_sl_pct is not None
            ):
                intent["plan"]["trailing_sl"] = {
                    "enabled": True,
                    "distance": {
                        "price": normalized.trailing_sl,
                        "pct": normalized.trailing_sl_pct,
                    },
                }

        # Apply route defaults if still missing.
        if (
            intent["plan"]["stop_loss"].get("price") is None
            and intent["plan"]["stop_loss"].get("pct") is None
        ):
            lvl = _level_from_dict(route_policy.get("default_stop_loss"))
            if lvl:
                intent["plan"]["stop_loss"] = lvl
        if (
            intent["plan"]["target"].get("price") is None
            and intent["plan"]["target"].get("pct") is None
        ):
            lvl = _level_from_dict(route_policy.get("default_target"))
            if lvl:
                intent["plan"]["target"] = lvl
        if not intent["plan"]["trailing_sl"].get("enabled"):
            lvl = _level_from_dict(route_policy.get("default_trailing_sl"))
            if lvl and (lvl.get("price") is not None or lvl.get("pct") is not None):
                intent["plan"]["trailing_sl"] = {"enabled": True, "distance": lvl}

    return intent
