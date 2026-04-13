"""S6.x ingestion queue items

Revision ID: 0014_ingestion_queue_items
Revises: 0013_add_execution_intent_json
Create Date: 2026-04-12

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_ingestion_queue_items"
down_revision = "0013_add_execution_intent_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ingestion_queue_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_ref", sa.String(length=255), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("broker_key", sa.String(length=50), nullable=False),
        sa.Column("canonical_id", sa.String(length=255), nullable=False),
        sa.Column("execution_mode", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("validation_state", sa.String(length=16), nullable=False),
        sa.Column("block_reason_code", sa.String(length=64), nullable=True),
        sa.Column("block_reason_message", sa.Text(), nullable=True),
        sa.Column("execution_intent_json", sa.JSON(), nullable=False),
        sa.Column("dispatched_order_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["dispatched_order_id"], ["orders.id"]),
        sa.UniqueConstraint("idempotency_key", name="uq_ingestion_queue_idem"),
    )

    op.create_index(
        "ix_ingestion_queue_items_created_at",
        "ingestion_queue_items",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_ingestion_queue_items_updated_at",
        "ingestion_queue_items",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_ingestion_queue_items_user_id",
        "ingestion_queue_items",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_ingestion_queue_items_correlation_id",
        "ingestion_queue_items",
        ["correlation_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ingestion_queue_items_correlation_id", table_name="ingestion_queue_items")
    op.drop_index("ix_ingestion_queue_items_user_id", table_name="ingestion_queue_items")
    op.drop_index("ix_ingestion_queue_items_updated_at", table_name="ingestion_queue_items")
    op.drop_index("ix_ingestion_queue_items_created_at", table_name="ingestion_queue_items")
    op.drop_table("ingestion_queue_items")
