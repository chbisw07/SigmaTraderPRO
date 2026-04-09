from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
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


class BrokerConnection(Base):
    __tablename__ = "broker_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "broker_key", name="uq_broker_user_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    broker_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    credentials_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_day: Mapped[date | None] = mapped_column(Date, nullable=True)

    last_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
