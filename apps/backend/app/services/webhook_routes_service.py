from __future__ import annotations

import secrets
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.models.webhook_route import WebhookRoute
from app.schemas.ingestion_queue import QueueExecutionMode


class WebhookRouteError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ResolvedWebhookRoute:
    user_id: int
    route_id: int | None
    source: str
    name: str | None
    default_broker_key: str | None
    default_execution_mode: QueueExecutionMode
    default_product: str | None
    default_order_type: str | None
    policy_json: dict | None


class WebhookRoutesService:
    def create_tradingview_route(
        self,
        db: Session,
        *,
        user: User,
        name: str | None,
        default_broker_key: str | None,
        default_execution_mode: QueueExecutionMode,
        default_product: str | None,
        default_order_type: str | None,
        policy_json: dict | None,
    ) -> tuple[WebhookRoute, str]:
        token = secrets.token_urlsafe(32)
        route = WebhookRoute(
            user_id=user.id,
            source="tradingview",
            name=name,
            secret_hash=hash_password(token),
            default_broker_key=default_broker_key,
            default_execution_mode=default_execution_mode.value,
            default_product=default_product,
            default_order_type=default_order_type,
            policy_json=policy_json,
            is_enabled=True,
        )
        db.add(route)
        db.commit()
        db.refresh(route)
        return route, token

    def list_routes(
        self, db: Session, *, user: User, source: str
    ) -> list[WebhookRoute]:
        return (
            db.query(WebhookRoute)
            .filter(WebhookRoute.user_id == user.id)
            .filter(WebhookRoute.source == source)
            .order_by(WebhookRoute.created_at.desc())
            .all()
        )

    def update_route(
        self,
        db: Session,
        *,
        user: User,
        route_id: int,
        name: str | None,
        default_broker_key: str | None,
        default_execution_mode: QueueExecutionMode | None,
        default_product: str | None,
        default_order_type: str | None,
        policy_json: dict | None,
        is_enabled: bool | None,
    ) -> WebhookRoute:
        route = (
            db.query(WebhookRoute)
            .filter(WebhookRoute.user_id == user.id)
            .filter(WebhookRoute.id == route_id)
            .one_or_none()
        )
        if not route:
            raise WebhookRouteError("Route not found")

        if name is not None:
            route.name = name
        if default_broker_key is not None:
            route.default_broker_key = default_broker_key
        if default_execution_mode is not None:
            route.default_execution_mode = default_execution_mode.value
        if default_product is not None:
            route.default_product = default_product
        if default_order_type is not None:
            route.default_order_type = default_order_type
        if policy_json is not None:
            route.policy_json = policy_json
        if is_enabled is not None:
            route.is_enabled = bool(is_enabled)

        db.commit()
        db.refresh(route)
        return route

    def resolve_tradingview_token(
        self, db: Session, *, token: str
    ) -> ResolvedWebhookRoute | None:
        token = str(token or "").strip()
        if not token:
            return None

        # Primary path: DB-backed opaque route mapping.
        routes = (
            db.query(WebhookRoute)
            .filter(WebhookRoute.source == "tradingview")
            .filter(WebhookRoute.is_enabled.is_(True))
            .all()
        )
        for route in routes:
            if verify_password(token, route.secret_hash):
                return ResolvedWebhookRoute(
                    user_id=route.user_id,
                    route_id=route.id,
                    source="tradingview",
                    name=route.name,
                    default_broker_key=route.default_broker_key,
                    default_execution_mode=QueueExecutionMode(
                        route.default_execution_mode
                    ),
                    default_product=route.default_product,
                    default_order_type=route.default_order_type,
                    policy_json=route.policy_json,
                )

        # Legacy fallback: environment token (single-tenant/dev). If enabled, the
        # route resolves to the only active user.
        expected = getattr(settings, "tradingview_route_token", None)
        fallback_enabled = bool(
            getattr(settings, "tradingview_env_token_fallback_enabled", False)
        )
        if fallback_enabled and expected and token == expected:
            active_users = db.query(User).filter(User.is_active.is_(True)).all()
            if len(active_users) == 1:
                u = active_users[0]
                return ResolvedWebhookRoute(
                    user_id=u.id,
                    route_id=None,
                    source="tradingview",
                    name="env_token",
                    default_broker_key=getattr(u, "last_used_broker", None),
                    default_execution_mode=QueueExecutionMode.manual_review,
                    default_product=None,
                    default_order_type=None,
                    policy_json=None,
                )

        return None


webhook_routes_service = WebhookRoutesService()
