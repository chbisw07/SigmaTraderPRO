"""S4.2.2 watchlists

Revision ID: 0009_create_watchlists
Revises: 0008_add_include_broker_orders
Create Date: 2026-04-11

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_create_watchlists"
down_revision = "0008_add_include_broker_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watchlists",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "is_default",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_watchlists_user_name"),
    )
    op.create_index(
        "ix_watchlists_user_id", "watchlists", ["user_id"], unique=False
    )
    op.create_index(
        "ix_watchlists_is_default", "watchlists", ["is_default"], unique=False
    )

    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("watchlist_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("symbol_key", sa.String(length=255), nullable=False),
        sa.Column("canonical_id", sa.String(length=255), nullable=True),
        sa.Column("exchange", sa.String(length=32), nullable=True),
        sa.Column("segment", sa.String(length=32), nullable=True),
        sa.Column("instrument_type", sa.String(length=32), nullable=True),
        sa.Column("display_symbol", sa.String(length=128), nullable=False),
        sa.Column("underlying", sa.String(length=64), nullable=True),
        sa.Column("expiry", sa.Date(), nullable=True),
        sa.Column("strike", sa.Numeric(14, 2), nullable=True),
        sa.Column("option_type", sa.String(length=8), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["watchlist_id"],
            ["watchlists.id"],
            name="fk_watchlist_items_watchlist_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "watchlist_id",
            "symbol_key",
            name="uq_watchlist_items_watchlist_symbol_key",
        ),
        sa.UniqueConstraint(
            "watchlist_id",
            "position",
            name="uq_watchlist_items_watchlist_position",
        ),
    )
    op.create_index(
        "ix_watchlist_items_watchlist_id",
        "watchlist_items",
        ["watchlist_id"],
        unique=False,
    )
    op.create_index(
        "ix_watchlist_items_position",
        "watchlist_items",
        ["position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_watchlist_items_position", table_name="watchlist_items")
    op.drop_index("ix_watchlist_items_watchlist_id", table_name="watchlist_items")
    op.drop_table("watchlist_items")
    op.drop_index("ix_watchlists_is_default", table_name="watchlists")
    op.drop_index("ix_watchlists_user_id", table_name="watchlists")
    op.drop_table("watchlists")
