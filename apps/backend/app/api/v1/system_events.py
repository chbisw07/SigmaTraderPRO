from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.system_event import SystemEvent
from app.models.user import User
from app.schemas.system_event import (
    SystemEventOut,
    SystemEventsCleanupResponse,
    SystemEventsListResponse,
)
from app.services.system_events_service import system_events_service

router = APIRouter(prefix="/system-events", tags=["system-events"])


def _to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _out(ev: SystemEvent) -> SystemEventOut:
    return SystemEventOut(
        id=ev.id,
        created_at=_to_iso(ev.created_at),
        level=ev.level,
        category=ev.category,
        message=ev.message,
        correlation_id=ev.correlation_id,
        broker=ev.broker,
        symbol=ev.symbol,
        metadata=ev.metadata_json,
    )


@router.get("", response_model=SystemEventsListResponse)
def list_events(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    level: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SystemEventsListResponse:
    rows = system_events_service.list(
        db,
        user_id=current_user.id,
        q=q,
        category=category,
        level=level,
        limit=limit,
    ).items
    return SystemEventsListResponse(items=[_out(r) for r in rows])


@router.post("/cleanup", response_model=SystemEventsCleanupResponse)
def cleanup(
    keep_days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SystemEventsCleanupResponse:
    deleted = system_events_service.cleanup(
        db, keep_days=keep_days, user_id=current_user.id
    )
    return SystemEventsCleanupResponse(deleted=deleted)
