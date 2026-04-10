"""S4.2 add orders.lots

Revision ID: 0006_add_orders_lots
Revises: 0005_create_orders
Create Date: 2026-04-10

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_add_orders_lots"
down_revision = "0005_create_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("lots", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "lots")

