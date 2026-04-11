from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class TokenPairResponse(BaseModel):
    token_type: str = "bearer"
    access_token: str
    refresh_token: str
    user: UserOut


class AccessTokenResponse(BaseModel):
    token_type: str = "bearer"
    access_token: str


class PreferencesUpdateRequest(BaseModel):
    last_used_broker: str | None = None
    include_broker_orders: bool | None = None
