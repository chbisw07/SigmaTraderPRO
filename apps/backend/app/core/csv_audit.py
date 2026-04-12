from __future__ import annotations

import csv
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.sanitization import sanitize

AUDIT_COLUMNS = [
    "timestamp",
    "level",
    "module",
    "category",
    "event_type",
    "correlation_id",
    "user_id",
    "broker",
    "symbol",
    "instrument_key",
    "action",
    "status",
    "message",
    "details",
]


@dataclass(frozen=True)
class CsvAuditConfig:
    directory: Path
    prefix: str = "ST"
    max_bytes: int = 10 * 1024 * 1024
    retention_days: int | None = 14
    now: Callable[[], datetime] = lambda: datetime.now(tz=UTC)


class CsvAuditLogger:
    """
    Operator-friendly CSV audit trail.

    Frozen PRD naming convention baseline:
      - ST_YYYYMMDD.csv
      - ST_YYYYMMDD_02.csv
    """

    def __init__(self, config: CsvAuditConfig) -> None:
        self._config = config
        self._config.directory.mkdir(parents=True, exist_ok=True)
        self._last_cleanup_day: str | None = None

    def _date_stamp(self) -> str:
        return self._config.now().strftime("%Y%m%d")

    def _maybe_cleanup(self) -> None:
        keep = self._config.retention_days
        if keep is None:
            return
        try:
            keep_days = int(keep)
        except Exception:
            return
        if keep_days <= 0:
            return
        day = self._date_stamp()
        if self._last_cleanup_day == day:
            return
        self.cleanup_old_files(keep_days=keep_days)
        self._last_cleanup_day = day

    def cleanup_old_files(self, *, keep_days: int) -> int:
        """
        Delete old audit CSV files for this prefix.

        Safe policy:
        - Only deletes files matching the prefix+date naming convention.
        - Deletes based on the date in the filename (not mtime).
        - Never deletes current-day files.
        """
        keep_days = int(keep_days)
        if keep_days < 1:
            keep_days = 1
        if keep_days > 3650:
            keep_days = 3650

        now = self._config.now()
        cutoff = now.date() - timedelta(days=keep_days)
        current_day = now.strftime("%Y%m%d")

        pattern = re.compile(
            rf"^{re.escape(self._config.prefix)}_(\d{{8}})(?:_(\d{{2}}))?\.csv$"
        )
        deleted = 0
        for path in self._config.directory.glob(f"{self._config.prefix}_*.csv"):
            m = pattern.match(path.name)
            if not m:
                continue
            stamp = m.group(1)
            if stamp == current_day:
                continue
            try:
                file_date = datetime.strptime(stamp, "%Y%m%d").date()
            except Exception:
                continue
            if file_date < cutoff:
                try:
                    path.unlink()
                    deleted += 1
                except Exception:
                    continue
        return deleted

    def _candidate_paths(self, day: str) -> list[Path]:
        base = self._config.directory / f"{self._config.prefix}_{day}.csv"
        paths = [base]
        for i in range(2, 100):
            paths.append(
                self._config.directory / f"{self._config.prefix}_{day}_{i:02}.csv"
            )
        return paths

    def _select_path(self) -> Path:
        day = self._date_stamp()
        for path in self._candidate_paths(day):
            if not path.exists():
                return path
            if self._config.max_bytes <= 0:
                return path
            if path.stat().st_size < self._config.max_bytes:
                return path
        return self._candidate_paths(day)[-1]

    def _ensure_header(self, path: Path) -> None:
        if path.exists() and path.stat().st_size > 0:
            return
        with path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=AUDIT_COLUMNS)
            writer.writeheader()

    def log(
        self,
        *,
        level: str,
        module: str,
        category: str,
        event_type: str,
        message: str,
        correlation_id: str | None = None,
        user_id: str | None = None,
        broker: str | None = None,
        symbol: str | None = None,
        instrument_key: str | None = None,
        action: str | None = None,
        status: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> Path:
        self._maybe_cleanup()
        path = self._select_path()
        self._ensure_header(path)

        row: dict[str, Any] = {
            "timestamp": self._config.now().isoformat(),
            "level": level,
            "module": module,
            "category": category,
            "event_type": event_type,
            "correlation_id": correlation_id,
            "user_id": user_id,
            "broker": broker,
            "symbol": symbol,
            "instrument_key": instrument_key,
            "action": action,
            "status": status,
            "message": message,
            "details": json.dumps(sanitize(details or {}), ensure_ascii=False),
        }

        with path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=AUDIT_COLUMNS)
            writer.writerow(row)

        return path
