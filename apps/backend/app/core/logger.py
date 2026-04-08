from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, Literal

from app.core.sanitization import sanitize

LogFormat = Literal["json", "console"]

_CONFIGURED = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Pull structured extras (best-effort).
        for key, value in record.__dict__.items():
            if key.startswith("_"):
                continue
            if key in {
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "message",
            }:
                continue
            payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(sanitize(payload), ensure_ascii=False, separators=(",", ":"))


def configure_logging(
    level: str = "INFO",
    log_format: LogFormat = "json",
) -> None:
    global _CONFIGURED  # noqa: PLW0603 - module-level singleton
    if _CONFIGURED:
        return

    root = logging.getLogger()
    root.setLevel(level.upper())

    handler = logging.StreamHandler(stream=sys.stdout)
    if log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

    root.handlers.clear()
    root.addHandler(handler)

    _CONFIGURED = True


def get_logger(name: str | None = None) -> logging.Logger:
    return logging.getLogger(name or "app")


def log_event(
    logger: logging.Logger,
    message: str,
    *,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    logger.log(level, message, extra=sanitize(fields))
