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


@lru_cache
def get_settings() -> Settings:
    env_file = ENV_FILE if ENV_FILE.exists() else None
    return Settings(_env_file=env_file, _env_file_encoding="utf-8")


settings = get_settings()
