from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserOut(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    last_used_broker: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
