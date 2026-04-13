from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class IngestionQueueItem(Base):
    """
    Execution-intent ingestion queue item (S6.x Queue Sprint A).

    Stores a normalized execution intent (entry + plan) and queue lifecycle
    metadata. This is the control plane between intent creation and broker
    dispatch.
    """

    __tablename__ = "ingestion_queue_items"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_ingestion_queue_idem"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)

    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(
        String(128), nullable=False, index=True
    )

    broker_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    canonical_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    execution_mode: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    validation_state: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )
    block_reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    block_reason_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    execution_intent_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    resolution_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="resolved", index=True
    )
    resolution_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    dispatched_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("orders.id"), nullable=True, index=True
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
