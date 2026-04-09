from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Instrument(Base):
    __tablename__ = "instruments"
    __table_args__ = (
        UniqueConstraint("canonical_id", name="uq_instruments_canonical"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    canonical_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    exchange: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    segment: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    instrument_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    symbol_root: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    display_symbol: Mapped[str] = mapped_column(String(128), nullable=False, index=True)

    underlying: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    strike: Mapped[float | None] = mapped_column(
        Numeric(12, 2), nullable=True, index=True
    )
    option_type: Mapped[str | None] = mapped_column(
        String(4), nullable=True, index=True
    )

    lot_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tick_size: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    isin: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", index=True
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
