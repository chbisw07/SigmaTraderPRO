from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.webhook_routes import (
    WebhookRouteCreateRequest,
    WebhookRouteCreateResponse,
    WebhookRouteOut,
    WebhookRouteUpdateRequest,
)
from app.services.webhook_routes_service import (
    WebhookRouteError,
    webhook_routes_service,
)

router = APIRouter(prefix="/webhook-routes", tags=["webhook_routes"])


def _out(route) -> WebhookRouteOut:
    return WebhookRouteOut.model_validate(route, from_attributes=True)


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
        )
        return WebhookRouteCreateResponse(route=_out(route), route_token=token)
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
    return _out(route)
