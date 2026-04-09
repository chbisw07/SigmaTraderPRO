"""S4.1 create orders

Revision ID: 0005_create_orders
Revises: 0004_create_instrument_registry
Create Date: 2026-04-09

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0005_create_orders"
down_revision = "0004_create_instrument_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("broker_key", sa.String(length=50), nullable=False),
        sa.Column("canonical_id", sa.String(length=255), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("product", sa.String(length=16), nullable=False),
        sa.Column("order_type", sa.String(length=16), nullable=False),
        sa.Column("limit_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("broker_order_id", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("ix_orders_user_id", "orders", ["user_id"])
    op.create_index("ix_orders_broker_key", "orders", ["broker_key"])
    op.create_index("ix_orders_canonical_id", "orders", ["canonical_id"])
    op.create_index("ix_orders_status", "orders", ["status"])


def downgrade() -> None:
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_index("ix_orders_canonical_id", table_name="orders")
    op.drop_index("ix_orders_broker_key", table_name="orders")
    op.drop_index("ix_orders_user_id", table_name="orders")
    op.drop_table("orders")
