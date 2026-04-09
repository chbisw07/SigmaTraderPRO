from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.request import urlopen

from sqlalchemy.orm import Session

from app.core.config import settings
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

        batch_size = 1000
        pending = 0

        for row in rows:
            processed += 1
            normalized = normalize_angel_instrument(row)
            if not normalized:
                skipped += 1
                continue
            instrument_registry_service.ingest_normalized(db, normalized)
            ingested += 1
            pending += 1
            if pending >= batch_size:
                db.commit()
                pending = 0

        if pending:
            db.commit()

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

    def sync_angel_master(
        self,
        db: Session,
        *,
        scope: str,
        underlyings: list[str] | None = None,
        max_rows: int | None = None,
    ) -> SyncResult:
        scope_key = scope.strip().lower()
        if scope_key not in {"equity", "fno_underlyings"}:
            raise ValueError("Invalid scope")

        underlyings_set = {
            u.strip().upper()
            for u in (underlyings or [])
            if isinstance(u, str) and u.strip()
        }
        if scope_key == "fno_underlyings" and not underlyings_set:
            raise ValueError("underlyings is required for fno_underlyings scope")

        url = settings.angel_instrument_master_url
        timeout = float(settings.angel_http_timeout_seconds)
        with urlopen(url, timeout=timeout) as resp:
            data = json.load(resp)

        if not isinstance(data, list):
            raise ValueError("Angel instrument master payload must be a list")

        selected: list[dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue

            exch_seg = str(row.get("exch_seg") or "").strip().upper()
            instrumenttype = str(row.get("instrumenttype") or "").strip().upper()
            symbol = str(row.get("symbol") or "")

            if scope_key == "equity":
                if exch_seg not in {"NSE", "BSE"}:
                    continue
                if instrumenttype not in {"EQ", "EQUITY"} and "-EQ" not in symbol:
                    continue
            elif scope_key == "fno_underlyings":
                if exch_seg not in {"NFO", "NSEFO", "NFOFO"}:
                    continue
                name = str(row.get("name") or "").strip().upper()
                if name not in underlyings_set:
                    continue

            selected.append(row)
            if max_rows and len(selected) >= max_rows:
                break

        return self.sync_angel_rows(db, selected)


instrument_sync_service = InstrumentSyncService()
