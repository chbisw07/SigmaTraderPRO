from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import get_logger, log_event
from app.brokers.angel_instrument_id import normalize_angel_exch_seg, encode_angel_instrument_id
from app.services.instrument_normalizer import (
    normalize_angel_instrument,
    normalize_zerodha_instrument,
)
from app.services.instrument_registry_service import instrument_registry_service

logger = get_logger(__name__)

class InstrumentSyncUpstreamError(RuntimeError):
    pass


class InstrumentSyncDatabaseError(RuntimeError):
    pass


class InstrumentSyncDependencyError(RuntimeError):
    pass


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
            try:
                instrument_registry_service.ingest_normalized(db, normalized)
            except SQLAlchemyError as exc:
                db.rollback()
                raise InstrumentSyncDatabaseError(
                    "Database write failed while syncing instruments. "
                    "Ensure Postgres is running and reachable."
                ) from exc
            ingested += 1
            pending += 1
            if pending >= batch_size:
                try:
                    db.commit()
                except SQLAlchemyError as exc:
                    db.rollback()
                    raise InstrumentSyncDatabaseError(
                        "Database write failed while syncing instruments. "
                        "Ensure Postgres is running and reachable."
                    ) from exc
                pending = 0

        if pending:
            try:
                db.commit()
            except SQLAlchemyError as exc:
                db.rollback()
                raise InstrumentSyncDatabaseError(
                    "Database write failed while syncing instruments. "
                    "Ensure Postgres is running and reachable."
                ) from exc

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

    def sync_zerodha_rows(self, db: Session, rows: list[dict[str, Any]]) -> SyncResult:
        processed = 0
        ingested = 0
        skipped = 0

        batch_size = 1000
        pending = 0

        for row in rows:
            processed += 1
            normalized = normalize_zerodha_instrument(row)
            if not normalized:
                skipped += 1
                continue
            try:
                instrument_registry_service.ingest_normalized(db, normalized)
            except SQLAlchemyError as exc:
                db.rollback()
                raise InstrumentSyncDatabaseError(
                    "Database write failed while syncing instruments. "
                    "Ensure Postgres is running and reachable."
                ) from exc
            ingested += 1
            pending += 1
            if pending >= batch_size:
                try:
                    db.commit()
                except SQLAlchemyError as exc:
                    db.rollback()
                    raise InstrumentSyncDatabaseError(
                        "Database write failed while syncing instruments. "
                        "Ensure Postgres is running and reachable."
                    ) from exc
                pending = 0

        if pending:
            try:
                db.commit()
            except SQLAlchemyError as exc:
                db.rollback()
                raise InstrumentSyncDatabaseError(
                    "Database write failed while syncing instruments. "
                    "Ensure Postgres is running and reachable."
                ) from exc

        log_event(
            logger,
            "instrument_sync_completed",
            category="instruments",
            event_type="sync",
            broker="zerodha",
            processed=processed,
            ingested=ingested,
            skipped=skipped,
        )
        return SyncResult(processed=processed, ingested=ingested, skipped=skipped)

    def _fetch_json(self, *, url: str, timeout_seconds: float) -> Any:
        headers = {
            "Accept": "application/json",
            # Some CDNs block default python user agents; use a browser-like UA.
            "User-Agent": "Mozilla/5.0 (SigmaTraderPRO)",
        }
        try:
            with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
                resp = client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise InstrumentSyncUpstreamError("Instrument master download failed (network error)") from exc

        if resp.status_code != 200:
            raise InstrumentSyncUpstreamError(
                f"Instrument master download failed (HTTP {resp.status_code})"
            )
        try:
            return resp.json()
        except Exception as exc:  # noqa: BLE001 - input may be malformed/HTML etc
            raise InstrumentSyncUpstreamError("Instrument master payload was not valid JSON") from exc

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
        # The Angel master can be large; use a slightly more forgiving timeout.
        timeout = max(15.0, float(settings.angel_http_timeout_seconds))
        data = self._fetch_json(url=url, timeout_seconds=timeout)

        if not isinstance(data, list):
            raise ValueError("Angel instrument master payload must be a list")

        selected: list[dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue

            exch_seg = normalize_angel_exch_seg(row.get("exch_seg")) or ""
            instrumenttype = str(row.get("instrumenttype") or "").strip().upper()
            symbol = str(row.get("symbol") or "")

            if scope_key == "equity":
                if exch_seg not in {"NSE", "BSE"}:
                    continue
                if instrumenttype not in {"EQ", "EQUITY"} and "-EQ" not in symbol:
                    continue
            elif scope_key == "fno_underlyings":
                if exch_seg not in {"NFO", "BFO"}:
                    continue
                name = str(row.get("name") or "").strip().upper()
                if name not in underlyings_set:
                    continue

            selected.append(row)
            if max_rows and len(selected) >= max_rows:
                break

        return self.sync_angel_rows(db, selected)

    def sync_zerodha_nfo(
        self,
        db: Session,
        *,
        api_key: str,
        access_token: str | None = None,
        underlyings: list[str] | None = None,
        max_rows: int | None = None,
    ) -> SyncResult:
        try:
            from kiteconnect import KiteConnect  # local import to keep core slim
        except Exception as exc:  # noqa: BLE001
            raise InstrumentSyncDependencyError(
                "kiteconnect is not available on the server. Install backend dependencies and restart."
            ) from exc

        kite = KiteConnect(api_key=api_key)
        if access_token:
            kite.set_access_token(access_token)
        try:
            rows = kite.instruments("NFO")
        except Exception as exc:  # noqa: BLE001 - external SDK best-effort
            msg = str(exc).strip().replace("\n", " ")
            msg = msg[:240] if msg else "unknown error"
            raise ValueError(
                "Zerodha instruments fetch failed. "
                "Reconnect Zerodha and retry. "
                f"({msg})"
            ) from exc
        if not isinstance(rows, list):
            raise ValueError("Zerodha instruments payload must be a list")

        underlyings_set = {
            u.strip().upper()
            for u in (underlyings or [])
            if isinstance(u, str) and u.strip()
        }
        if not underlyings_set:
            raise ValueError("underlyings is required for zerodha_nfo sync")

        selected: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip().upper()
            if name not in underlyings_set:
                continue
            selected.append(row)
            if max_rows and len(selected) >= max_rows:
                break

        return self.sync_zerodha_rows(db, selected)

    def sync_zerodha_tokens(
        self,
        db: Session,
        *,
        api_key: str,
        access_token: str | None = None,
        instrument_tokens: list[str],
        max_rows: int | None = None,
    ) -> SyncResult:
        """
        Targeted Zerodha instrument sync for a specific set of instrument tokens.

        Used for on-demand mapping when a position exists but the instrument is
        not yet present in the local registry.
        """
        try:
            from kiteconnect import KiteConnect  # local import to keep core slim
        except Exception as exc:  # noqa: BLE001
            raise InstrumentSyncDependencyError(
                "kiteconnect is not available on the server. Install backend dependencies and restart."
            ) from exc

        wanted = {
            str(t).strip()
            for t in instrument_tokens
            if isinstance(t, str) and str(t).strip()
        }
        if not wanted:
            raise ValueError("instrument_tokens is required for zerodha token sync")

        kite = KiteConnect(api_key=api_key)
        if access_token:
            kite.set_access_token(access_token)

        selected: list[dict[str, Any]] = []
        remaining = set(wanted)
        # Positions can contain cash + derivatives. Try common exchanges in order.
        any_fetch = False
        for exch in ["NFO", "BFO", "NSE", "BSE"]:
            if not remaining:
                break
            try:
                rows = kite.instruments(exch)
                any_fetch = True
            except Exception:  # noqa: BLE001 - external SDK best-effort
                # Not all accounts have access to all exchanges (e.g., BFO). Try the next.
                continue
            if not isinstance(rows, list):
                raise ValueError("Zerodha instruments payload must be a list")

            for row in rows:
                if not isinstance(row, dict):
                    continue
                token = row.get("instrument_token")
                if token is None:
                    continue
                token_s = str(token)
                if token_s not in remaining:
                    continue
                selected.append(row)
                remaining.discard(token_s)
                if max_rows and len(selected) >= max_rows:
                    break

        if not any_fetch:
            raise ValueError("Zerodha instruments fetch failed. Reconnect Zerodha and retry.")

        return self.sync_zerodha_rows(db, selected)

    def sync_angel_tokens(
        self,
        db: Session,
        *,
        instrument_tokens: list[str],
        max_rows: int | None = None,
    ) -> SyncResult:
        """
        Targeted Angel instrument master sync for a specific set of tokens.

        Used for on-demand mapping when a position exists but the instrument is
        not yet present in the local registry.
        """
        wanted: set[str] = set()
        wanted_tokens: set[str] = set()
        for t in instrument_tokens:
            if not isinstance(t, str):
                continue
            raw = str(t).strip()
            if not raw:
                continue
            if ":" in raw:
                wanted.add(raw.upper())
            else:
                wanted_tokens.add(raw)
        if not wanted:
            # Fall back to raw token matches (less precise).
            wanted = set()
        if not wanted and not wanted_tokens:
            raise ValueError("instrument_tokens is required for angel token sync")

        url = settings.angel_instrument_master_url
        timeout = max(15.0, float(settings.angel_http_timeout_seconds))
        data = self._fetch_json(url=url, timeout_seconds=timeout)

        if not isinstance(data, list):
            raise ValueError("Angel instrument master payload must be a list")

        selected: list[dict[str, Any]] = []
        for row in data:
            if not isinstance(row, dict):
                continue
            token = row.get("token")
            if token is None:
                continue
            token_s = str(token).strip()
            exch_seg = normalize_angel_exch_seg(row.get("exch_seg"))
            composite = encode_angel_instrument_id(exch_seg=exch_seg, token=token_s)
            if composite:
                if composite.upper() in wanted:
                    selected.append(row)
                    if max_rows and len(selected) >= max_rows:
                        break
                    continue
            if token_s not in wanted_tokens:
                continue
            selected.append(row)
            if max_rows and len(selected) >= max_rows:
                break

        return self.sync_angel_rows(db, selected)


instrument_sync_service = InstrumentSyncService()
