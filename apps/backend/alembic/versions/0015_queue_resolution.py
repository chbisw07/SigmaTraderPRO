"""queue resolution metadata (Sprint B)

Revision ID: 0015_queue_resolution
Revises: 0014_ingestion_queue_items
Create Date: 2026-04-13

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_queue_resolution"
down_revision = "0014_ingestion_queue_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingestion_queue_items",
        sa.Column(
            "resolution_state",
            sa.String(length=16),
            nullable=False,
            server_default="resolved",
        ),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("resolution_json", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_ingestion_queue_items_resolution_state",
        "ingestion_queue_items",
        ["resolution_state"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ingestion_queue_items_resolution_state", table_name="ingestion_queue_items"
    )
    op.drop_column("ingestion_queue_items", "resolution_json")
    op.drop_column("ingestion_queue_items", "resolution_state")

