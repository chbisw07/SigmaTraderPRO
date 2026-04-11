"""S4.2.1 broker order inclusion preference

Revision ID: 0008_add_include_broker_orders
Revises: 0007_order_intent_and_positions
Create Date: 2026-04-11

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_add_include_broker_orders"
down_revision = "0007_order_intent_and_positions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "include_broker_orders",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_users_include_broker_orders",
        "users",
        ["include_broker_orders"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_users_include_broker_orders", table_name="users")
    op.drop_column("users", "include_broker_orders")

