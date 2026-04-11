from __future__ import annotations

import logging
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.logger import get_logger, log_event
from app.models.system_event import SystemEvent

logger = get_logger(__name__)


class SystemEventLevel:
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


@dataclass(frozen=True, slots=True)
class SystemEventsList:
    items: list[SystemEvent]


class SystemEventsService:
    def emit(
        self,
        db: Session,
        *,
        level: str,
        category: str,
        message: str,
        correlation_id: str | None = None,
        user_id: int | None = None,
        broker: str | None = None,
        symbol: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SystemEvent | None:
        """
        Best-effort durable operator event emission.

        Must never break primary flows (orders/brokers) if persistence fails.
        """
        try:
            ev = SystemEvent(
                level=level,
                category=category,
                message=message,
                correlation_id=correlation_id,
                user_id=user_id,
                broker=broker,
                symbol=symbol,
                metadata_json=metadata or None,
            )
            db.add(ev)
            db.commit()
            db.refresh(ev)
            return ev
        except Exception as exc:  # noqa: BLE001
            with suppress(Exception):
                db.rollback()
            log_event(
                logger,
                "system_event_emit_failed",
                level=logging.ERROR,
                category="system_events",
                event_type="emit",
                error=str(exc),
                target_category=category,
                correlation_id=correlation_id,
            )
            return None

    def list(
        self,
        db: Session,
        *,
        user_id: int | None,
        q: str | None = None,
        category: str | None = None,
        level: str | None = None,
        limit: int = 200,
    ) -> SystemEventsList:
        qry = db.query(SystemEvent)

        # Scope: show system-level events (user_id is null) plus events for user.
        if user_id is not None:
            qry = qry.filter(
                (SystemEvent.user_id.is_(None)) | (SystemEvent.user_id == user_id)
            )

        if category:
            qry = qry.filter(SystemEvent.category == category)
        if level:
            qry = qry.filter(SystemEvent.level == level)
        if q:
            like = f"%{q.strip()}%"
            qry = qry.filter(
                (SystemEvent.message.ilike(like))
                | (SystemEvent.category.ilike(like))
                | (SystemEvent.correlation_id.ilike(like))
                | (SystemEvent.broker.ilike(like))
                | (SystemEvent.symbol.ilike(like))
            )

        qry = qry.order_by(desc(SystemEvent.created_at)).limit(limit)
        return SystemEventsList(items=list(qry.all()))

    def cleanup(
        self,
        db: Session,
        *,
        keep_days: int,
        user_id: int | None,
    ) -> int:
        keep_days = int(keep_days)
        if keep_days < 1:
            keep_days = 1
        if keep_days > 365:
            keep_days = 365

        threshold = datetime.now(tz=UTC) - timedelta(days=keep_days)
        qry = db.query(SystemEvent).filter(SystemEvent.created_at < threshold)

        if user_id is not None:
            qry = qry.filter(
                (SystemEvent.user_id.is_(None)) | (SystemEvent.user_id == user_id)
            )

        deleted = int(qry.delete(synchronize_session=False))
        db.commit()
        return deleted


system_events_service = SystemEventsService()
