"""S3.2 create canonical instrument registry

Revision ID: 0004_create_instrument_registry
Revises: 0003_create_broker_connections
Create Date: 2026-04-09

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_create_instrument_registry"
down_revision = "0003_create_broker_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("canonical_id", sa.String(length=255), nullable=False),
        sa.Column("exchange", sa.String(length=20), nullable=False),
        sa.Column("segment", sa.String(length=20), nullable=False),
        sa.Column("instrument_type", sa.String(length=20), nullable=False),
        sa.Column("symbol_root", sa.String(length=64), nullable=False),
        sa.Column("display_symbol", sa.String(length=128), nullable=False),
        sa.Column("underlying", sa.String(length=64), nullable=True),
        sa.Column("expiry", sa.Date(), nullable=True),
        sa.Column("strike", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("option_type", sa.String(length=4), nullable=True),
        sa.Column("lot_size", sa.Integer(), nullable=True),
        sa.Column("tick_size", sa.Numeric(precision=10, scale=4), nullable=True),
        sa.Column("isin", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("canonical_id", name="uq_instruments_canonical"),
    )
    op.create_index("ix_instruments_canonical_id", "instruments", ["canonical_id"], unique=False)
    op.create_index("ix_instruments_exchange", "instruments", ["exchange"], unique=False)
    op.create_index("ix_instruments_segment", "instruments", ["segment"], unique=False)
    op.create_index(
        "ix_instruments_instrument_type", "instruments", ["instrument_type"], unique=False
    )
    op.create_index("ix_instruments_symbol_root", "instruments", ["symbol_root"], unique=False)
    op.create_index(
        "ix_instruments_display_symbol", "instruments", ["display_symbol"], unique=False
    )
    op.create_index("ix_instruments_underlying", "instruments", ["underlying"], unique=False)
    op.create_index("ix_instruments_expiry", "instruments", ["expiry"], unique=False)
    op.create_index("ix_instruments_strike", "instruments", ["strike"], unique=False)
    op.create_index("ix_instruments_option_type", "instruments", ["option_type"], unique=False)
    op.create_index("ix_instruments_isin", "instruments", ["isin"], unique=False)
    op.create_index("ix_instruments_is_active", "instruments", ["is_active"], unique=False)

    op.create_table(
        "instrument_mappings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "instrument_id",
            sa.Integer(),
            sa.ForeignKey("instruments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("broker_key", sa.String(length=50), nullable=False),
        sa.Column("broker_instrument_id", sa.String(length=128), nullable=False),
        sa.Column("broker_trading_symbol", sa.String(length=128), nullable=True),
        sa.Column("raw", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("broker_key", "broker_instrument_id", name="uq_map_broker_id"),
        sa.UniqueConstraint("broker_key", "instrument_id", name="uq_map_broker_instrument"),
    )
    op.create_index(
        "ix_instrument_mappings_instrument_id",
        "instrument_mappings",
        ["instrument_id"],
        unique=False,
    )
    op.create_index(
        "ix_instrument_mappings_broker_key",
        "instrument_mappings",
        ["broker_key"],
        unique=False,
    )
    op.create_index(
        "ix_instrument_mappings_broker_instrument_id",
        "instrument_mappings",
        ["broker_instrument_id"],
        unique=False,
    )
    op.create_index(
        "ix_instrument_mappings_broker_trading_symbol",
        "instrument_mappings",
        ["broker_trading_symbol"],
        unique=False,
    )
    op.create_index(
        "ix_instrument_mappings_is_active",
        "instrument_mappings",
        ["is_active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_instrument_mappings_is_active", table_name="instrument_mappings")
    op.drop_index(
        "ix_instrument_mappings_broker_trading_symbol", table_name="instrument_mappings"
    )
    op.drop_index(
        "ix_instrument_mappings_broker_instrument_id", table_name="instrument_mappings"
    )
    op.drop_index("ix_instrument_mappings_broker_key", table_name="instrument_mappings")
    op.drop_index(
        "ix_instrument_mappings_instrument_id", table_name="instrument_mappings"
    )
    op.drop_table("instrument_mappings")

    op.drop_index("ix_instruments_is_active", table_name="instruments")
    op.drop_index("ix_instruments_isin", table_name="instruments")
    op.drop_index("ix_instruments_option_type", table_name="instruments")
    op.drop_index("ix_instruments_strike", table_name="instruments")
    op.drop_index("ix_instruments_expiry", table_name="instruments")
    op.drop_index("ix_instruments_underlying", table_name="instruments")
    op.drop_index("ix_instruments_display_symbol", table_name="instruments")
    op.drop_index("ix_instruments_symbol_root", table_name="instruments")
    op.drop_index("ix_instruments_instrument_type", table_name="instruments")
    op.drop_index("ix_instruments_segment", table_name="instruments")
    op.drop_index("ix_instruments_exchange", table_name="instruments")
    op.drop_index("ix_instruments_canonical_id", table_name="instruments")
    op.drop_table("instruments")

