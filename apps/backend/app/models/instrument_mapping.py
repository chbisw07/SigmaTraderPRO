from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InstrumentMapping(Base):
    __tablename__ = "instrument_mappings"
    __table_args__ = (
        UniqueConstraint("broker_key", "broker_instrument_id", name="uq_map_broker_id"),
        UniqueConstraint(
            "broker_key", "instrument_id", name="uq_map_broker_instrument"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("instruments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    broker_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    broker_instrument_id: Mapped[str] = mapped_column(
        String(128), nullable=False, index=True
    )
    broker_trading_symbol: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )

    raw: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

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
