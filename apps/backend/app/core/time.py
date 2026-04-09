from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def today_ist() -> date:
    return datetime.now(tz=IST).date()
