from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Order(Base):
    """
    Minimal manual order record (cash instruments only for S4.1).

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
    product: Mapped[str] = mapped_column(String(16), nullable=False)
    order_type: Mapped[str] = mapped_column(String(16), nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
