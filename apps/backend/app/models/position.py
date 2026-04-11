from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Position(Base):
    """
    Broker-neutral position record (S4.2.1).

    Canonical-first: `canonical_id` is the stable instrument identity.
    Broker-specific identifiers remain secondary/internal.
    """

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "broker_key",
            "canonical_id",
            name="uq_positions_user_broker_canonical",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    broker_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    canonical_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Net position state (side + positive qty/lots).
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    lots: Mapped[int | None] = mapped_column(Integer, nullable=True)

    avg_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    last_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    realized_pnl: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    unrealized_pnl: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    mtm: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    broker_position_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
