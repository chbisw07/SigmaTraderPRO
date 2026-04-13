from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WebhookRoute(Base):
    """
    Durable webhook route secret mapping.

    Purpose:
      - Resolve an opaque route token to a user + defaults (broker/product/mode).
      - Prevent unauthenticated public traffic from injecting queue items.

    Secrets are never stored in plaintext; only a hash is persisted.
    """

    __tablename__ = "webhook_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    default_broker_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    default_execution_mode: Mapped[str] = mapped_column(
        String(32), nullable=False, default="manual_review"
    )
    default_product: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_order_type: Mapped[str | None] = mapped_column(String(16), nullable=True)

    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
