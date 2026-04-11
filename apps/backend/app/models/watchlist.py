from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Watchlist(Base):
    __tablename__ = "watchlists"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "name",
            name="uq_watchlists_user_name",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", index=True
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


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        UniqueConstraint(
            "watchlist_id",
            "symbol_key",
            name="uq_watchlist_items_watchlist_symbol_key",
        ),
        UniqueConstraint(
            "watchlist_id",
            "position",
            name="uq_watchlist_items_watchlist_position",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    watchlist_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("watchlists.id"), nullable=False, index=True
    )

    position: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # Stable dedupe identity within a watchlist.
    # - canonical_id if present
    # - else "UNDERLYING:<NAME>" for underlying-only rows
    symbol_key: Mapped[str] = mapped_column(String(255), nullable=False)

    canonical_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Snapshot fields for fast render (canonical-first; safe, non-secret).
    exchange: Mapped[str | None] = mapped_column(String(32), nullable=True)
    segment: Mapped[str | None] = mapped_column(String(32), nullable=True)
    instrument_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    display_symbol: Mapped[str] = mapped_column(String(128), nullable=False)

    underlying: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    strike: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    option_type: Mapped[str | None] = mapped_column(String(8), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
