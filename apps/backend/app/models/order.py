from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Order(Base):
    """
    Minimal manual order record (expanded for cash + F&O tickets in S4.x).

    Canonical-first: `canonical_id` is the stable instrument identity.
    Broker-specific identifiers (e.g. broker_order_id) are stored but not treated
    as the truth model.
    """

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    broker_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    canonical_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    side: Mapped[str] = mapped_column(String(8), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    lots: Mapped[int | None] = mapped_column(Integer, nullable=True)
    product: Mapped[str] = mapped_column(String(16), nullable=False)
    order_type: Mapped[str] = mapped_column(String(16), nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    avg_executed_price: Mapped[float | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    # Execution semantics / intent metadata (S4.2.1).
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    intent_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    trigger_mode: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    risk_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sl_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    tp_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    trailing_value: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    parent_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("orders.id"), nullable=True, index=True
    )
    linked_position_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("positions.id"), nullable=True, index=True
    )
    broker_context: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Snapshots and internal resolution (safe for persistence; no secrets).
    preview_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    broker_payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    execution_intent_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    broker_symbol_resolved: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    broker_symbol_token_resolved: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    lot_size_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    margin_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # S4.3 dispatch correlation + explicit block/failure reason surfaces.
    correlation_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    blocked_reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    blocked_reason_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_reason_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    dispatch_tags_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dispatch_diagnostics_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
