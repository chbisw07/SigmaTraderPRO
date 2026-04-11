"""S5.1 webhook ingestion inbox

Revision ID: 0012_webhook_ingestions
Revises: 0011_system_events
Create Date: 2026-04-11

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_webhook_ingestions"
down_revision = "0011_system_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_ingestions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("correlation_id", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.String(length=16), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=True),
        sa.Column("reason_message", sa.Text(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=False, server_default="200"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False),
        sa.Column("normalized_payload_json", sa.JSON(), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_webhook_ingestions_idem"),
    )

    op.create_index(
        "ix_webhook_ingestions_source",
        "webhook_ingestions",
        ["source"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_ingestions_received_at",
        "webhook_ingestions",
        ["received_at"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_ingestions_correlation_id",
        "webhook_ingestions",
        ["correlation_id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_ingestions_schema_version",
        "webhook_ingestions",
        ["schema_version"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_ingestions_status",
        "webhook_ingestions",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_ingestions_status", table_name="webhook_ingestions")
    op.drop_index(
        "ix_webhook_ingestions_schema_version", table_name="webhook_ingestions"
    )
    op.drop_index(
        "ix_webhook_ingestions_correlation_id", table_name="webhook_ingestions"
    )
    op.drop_index(
        "ix_webhook_ingestions_received_at", table_name="webhook_ingestions"
    )
    op.drop_index("ix_webhook_ingestions_source", table_name="webhook_ingestions")
    op.drop_table("webhook_ingestions")

