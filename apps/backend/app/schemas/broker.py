from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.brokers.types import BrokerKey, BrokerSessionState


class BrokerStatusOut(BaseModel):
    broker: BrokerKey
    configured: bool
    enabled: bool
    state: BrokerSessionState
    connected: bool
    stale: bool
    session_day: date | None = None
    last_connected_at: datetime | None = None
    last_error: str | None = None


class AngelSettingsIn(BaseModel):
    is_enabled: bool = True
    api_key: str = Field(min_length=1)
    client_code: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AngelConnectIn(BaseModel):
    totp: str = Field(min_length=1)


class ZerodhaSettingsIn(BaseModel):
    is_enabled: bool = True
    api_key: str = Field(min_length=1)
    api_secret: str = Field(min_length=1)


class ZerodhaConnectIn(BaseModel):
    request_token: str = Field(min_length=1)


class BrokerLoginUrlOut(BaseModel):
    url: str
