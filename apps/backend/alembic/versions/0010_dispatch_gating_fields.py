"""S4.3 order dispatch gating fields

Revision ID: 0010_dispatch_gating_fields
Revises: 0009_create_watchlists
Create Date: 2026-04-11

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_dispatch_gating_fields"
down_revision = "0009_create_watchlists"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("correlation_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("blocked_reason_code", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("blocked_reason_message", sa.Text(), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("failure_reason_code", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("failure_reason_message", sa.Text(), nullable=True)
    )
    op.add_column("orders", sa.Column("dispatch_tags_json", sa.JSON(), nullable=True))
    op.add_column(
        "orders", sa.Column("dispatch_diagnostics_json", sa.JSON(), nullable=True)
    )
    op.create_index(
        "ix_orders_correlation_id", "orders", ["correlation_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_orders_correlation_id", table_name="orders")
    op.drop_column("orders", "dispatch_diagnostics_json")
    op.drop_column("orders", "dispatch_tags_json")
    op.drop_column("orders", "failure_reason_message")
    op.drop_column("orders", "failure_reason_code")
    op.drop_column("orders", "blocked_reason_message")
    op.drop_column("orders", "blocked_reason_code")
    op.drop_column("orders", "correlation_id")
