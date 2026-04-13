"""webhook route secrets (TradingView routing)

Revision ID: 0016_webhook_routes
Revises: 0015_queue_resolution
Create Date: 2026-04-13

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_webhook_routes"
down_revision = "0015_queue_resolution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_routes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("secret_hash", sa.String(length=255), nullable=False),
        sa.Column("default_broker_key", sa.String(length=50), nullable=True),
        sa.Column("default_execution_mode", sa.String(length=32), nullable=False),
        sa.Column("default_product", sa.String(length=16), nullable=True),
        sa.Column("default_order_type", sa.String(length=16), nullable=True),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index(
        "ix_webhook_routes_source",
        "webhook_routes",
        ["source"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_routes_user_id",
        "webhook_routes",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_routes_user_id", table_name="webhook_routes")
    op.drop_index("ix_webhook_routes_source", table_name="webhook_routes")
    op.drop_table("webhook_routes")
