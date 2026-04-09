from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.core.logger import get_logger, log_event
from app.services.instrument_normalizer import normalize_angel_instrument
from app.services.instrument_registry_service import instrument_registry_service

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SyncResult:
    processed: int
    ingested: int
    skipped: int


class InstrumentSyncService:
    def sync_angel_rows(self, db: Session, rows: list[dict[str, Any]]) -> SyncResult:
        processed = 0
        ingested = 0
        skipped = 0

        for row in rows:
            processed += 1
            normalized = normalize_angel_instrument(row)
            if not normalized:
                skipped += 1
                continue
            instrument_registry_service.ingest_normalized(db, normalized)
            ingested += 1

        log_event(
            logger,
            "instrument_sync_completed",
            category="instruments",
            event_type="sync",
            broker="angel",
            processed=processed,
            ingested=ingested,
            skipped=skipped,
        )
        return SyncResult(processed=processed, ingested=ingested, skipped=skipped)


instrument_sync_service = InstrumentSyncService()
