from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.schemas.webhook_routes import (
    WebhookRouteCreateRequest,
    WebhookRouteCreateResponse,
    WebhookRouteOut,
    WebhookRouteUpdateRequest,
)
from app.services.system_events_service import SystemEventLevel, system_events_service
from app.services.webhook_routes_service import (
    WebhookRouteError,
    webhook_routes_service,
)

router = APIRouter(prefix="/webhook-routes", tags=["webhook_routes"])
logger = get_logger(__name__)


def _out(route) -> WebhookRouteOut:
    payload = WebhookRouteOut.model_validate(route, from_attributes=True).model_dump()
    payload["policy"] = route.policy_json or None
    return WebhookRouteOut.model_validate(payload)


@router.get("/tradingview", response_model=list[WebhookRouteOut])
def list_tradingview_routes(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[WebhookRouteOut]:
    try:
        routes = webhook_routes_service.list_routes(
            db, user=current_user, source="tradingview"
        )
        return [_out(r) for r in routes]
    except OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Database schema not migrated (missing webhook_routes table). "
                "Run `make backend-migrate` and restart the backend."
            ),
        ) from exc


@router.post("/tradingview", response_model=WebhookRouteCreateResponse)
def create_tradingview_route(
    payload: WebhookRouteCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WebhookRouteCreateResponse:
    try:
        route, token = webhook_routes_service.create_tradingview_route(
            db,
            user=current_user,
            name=payload.name,
            default_broker_key=payload.default_broker_key,
            default_execution_mode=payload.default_execution_mode,
            default_product=(
                payload.default_product.value if payload.default_product else None
            ),
            default_order_type=(
                payload.default_order_type.value if payload.default_order_type else None
            ),
            policy_json=(
                payload.policy.model_dump(mode="json") if payload.policy else None
            ),
        )
        out = WebhookRouteCreateResponse(route=_out(route), route_token=token)

        correlation_id = str(uuid4())
        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="webhook_routes",
            message="TradingView route created",
            correlation_id=correlation_id,
            user_id=current_user.id,
            metadata={
                "source": "tradingview",
                "route_id": route.id,
                "default_broker_key": route.default_broker_key,
                "default_execution_mode": route.default_execution_mode,
                "default_product": route.default_product,
                "default_order_type": route.default_order_type,
                "has_policy": bool(route.policy_json),
            },
        )
        log_event(
            logger,
            "webhook_route_created",
            category="webhook_routes",
            event_type="create",
            user_id=current_user.id,
            correlation_id=correlation_id,
            route_id=route.id,
            source="tradingview",
            status="created",
        )
        audit = getattr(request.app.state, "csv_audit", None)
        if audit:
            audit.log(
                level="INFO",
                module=__name__,
                category="webhook_routes",
                event_type="route_created",
                message="tradingview_route_created",
                user_id=str(current_user.id),
                action="create",
                status="created",
                correlation_id=correlation_id,
                details={
                    "route_id": route.id,
                    "source": "tradingview",
                    "default_broker_key": route.default_broker_key,
                    "default_execution_mode": route.default_execution_mode,
                    "default_product": route.default_product,
                },
            )

        return out
    except OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Database schema not migrated (missing webhook_routes table). "
                "Run `make backend-migrate` and restart the backend."
            ),
        ) from exc


@router.patch("/tradingview/{route_id}", response_model=WebhookRouteOut)
def update_tradingview_route(
    route_id: int,
    payload: WebhookRouteUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> WebhookRouteOut:
    try:
        route = webhook_routes_service.update_route(
            db,
            user=current_user,
            route_id=route_id,
            name=payload.name,
            default_broker_key=payload.default_broker_key,
            default_execution_mode=payload.default_execution_mode,
            default_product=(
                payload.default_product.value if payload.default_product else None
            ),
            default_order_type=(
                payload.default_order_type.value if payload.default_order_type else None
            ),
            policy_json=(
                payload.policy.model_dump(mode="json") if payload.policy else None
            ),
            is_enabled=payload.is_enabled,
        )
    except WebhookRouteError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OperationalError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Database schema not migrated (missing webhook_routes table). "
                "Run `make backend-migrate` and restart the backend."
            ),
        ) from exc
    correlation_id = str(uuid4())
    msg = "TradingView route updated"
    if payload.is_enabled is False:
        msg = "TradingView route disabled"
    elif payload.is_enabled is True:
        msg = "TradingView route enabled"
    system_events_service.emit(
        db,
        level=SystemEventLevel.INFO,
        category="webhook_routes",
        message=msg,
        correlation_id=correlation_id,
        user_id=current_user.id,
        metadata={
            "source": "tradingview",
            "route_id": route.id,
            "is_enabled": route.is_enabled,
        },
    )
    log_event(
        logger,
        "webhook_route_updated",
        category="webhook_routes",
        event_type="update",
        user_id=current_user.id,
        correlation_id=correlation_id,
        route_id=route.id,
        source="tradingview",
        status="updated",
    )
    audit = getattr(request.app.state, "csv_audit", None)
    if audit:
        audit.log(
            level="INFO",
            module=__name__,
            category="webhook_routes",
            event_type="route_updated",
            message="tradingview_route_updated",
            user_id=str(current_user.id),
            action="update",
            status="updated",
            correlation_id=correlation_id,
            details={
                "route_id": route.id,
                "source": "tradingview",
                "is_enabled": route.is_enabled,
            },
        )

    return _out(route)
