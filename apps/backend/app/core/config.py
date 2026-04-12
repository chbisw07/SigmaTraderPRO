from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(default="SigmaTraderPRO", validation_alias="APP_NAME")
    app_env: str = Field(default="development", validation_alias="APP_ENV")
    app_host: str = Field(default="127.0.0.1", validation_alias="APP_HOST")
    app_port: int = Field(default=8000, validation_alias="APP_PORT")

    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_format: str = Field(default="json", validation_alias="LOG_FORMAT")
    log_dir: Path = Field(default=BACKEND_ROOT / ".logs", validation_alias="LOG_DIR")
    audit_csv_dir: Path = Field(
        default=BACKEND_ROOT / ".audit", validation_alias="AUDIT_CSV_DIR"
    )
    audit_csv_max_bytes: int = Field(
        default=10 * 1024 * 1024, validation_alias="AUDIT_CSV_MAX_BYTES"
    )
    audit_csv_retention_days: int = Field(
        default=14, validation_alias="AUDIT_CSV_RETENTION_DAYS"
    )

    jwt_secret_key: str = Field(
        default="dev-insecure-change-me-please-use-32-bytes-min",
        validation_alias="JWT_SECRET_KEY",
    )
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=15, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    refresh_token_expire_minutes: int = Field(
        default=60 * 24 * 7, validation_alias="REFRESH_TOKEN_EXPIRE_MINUTES"
    )

    database_url: str = Field(
        default="postgresql+psycopg://sigmatrader:sigmatrader@127.0.0.1:5432/sigmatraderpro",
        validation_alias="DATABASE_URL",
    )
    redis_url: str = Field(
        default="redis://127.0.0.1:6379/0",
        validation_alias="REDIS_URL",
    )

    broker_encryption_key: str = Field(
        default="dev-broker-encryption-key-change-me",
        validation_alias="BROKER_ENCRYPTION_KEY",
    )

    angel_http_timeout_seconds: float = Field(
        default=10.0, validation_alias="ANGEL_HTTP_TIMEOUT_SECONDS"
    )
    angel_client_local_ip: str = Field(
        default="127.0.0.1", validation_alias="ANGEL_CLIENT_LOCAL_IP"
    )
    angel_client_public_ip: str = Field(
        default="127.0.0.1", validation_alias="ANGEL_CLIENT_PUBLIC_IP"
    )
    angel_mac_address: str = Field(
        default="00:00:00:00:00:00", validation_alias="ANGEL_MAC_ADDRESS"
    )

    angel_instrument_master_url: str = Field(
        default="https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json",
        validation_alias="ANGEL_INSTRUMENT_MASTER_URL",
    )

    # S4.3 operator kill-switch (default: enabled). When disabled, manual order
    # submissions are intentionally blocked before any broker dispatch attempt.
    orders_dispatch_enabled: bool = Field(
        default=True, validation_alias="ORDERS_DISPATCH_ENABLED"
    )

    # TradingView webhook ingestion (S5.1)
    tradingview_route_token: str | None = Field(
        default=None, validation_alias="TRADINGVIEW_ROUTE_TOKEN"
    )
    tradingview_supported_schema_versions: str = Field(
        default="1", validation_alias="TRADINGVIEW_SUPPORTED_SCHEMA_VERSIONS"
    )


@lru_cache
def get_settings() -> Settings:
    env_file = ENV_FILE if ENV_FILE.exists() else None
    return Settings(_env_file=env_file, _env_file_encoding="utf-8")


settings = get_settings()
