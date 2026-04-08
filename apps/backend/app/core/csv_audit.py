from __future__ import annotations

import csv
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
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

    def _date_stamp(self) -> str:
        return self._config.now().strftime("%Y%m%d")

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
