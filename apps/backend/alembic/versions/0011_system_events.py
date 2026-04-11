"""ML1 system events table

Revision ID: 0011_system_events
Revises: 0010_dispatch_gating_fields
Create Date: 2026-04-11

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_system_events"
down_revision = "0010_dispatch_gating_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("broker", sa.String(length=50), nullable=True),
        sa.Column("symbol", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_system_events_created_at", "system_events", ["created_at"], unique=False
    )
    op.create_index(
        "ix_system_events_level", "system_events", ["level"], unique=False
    )
    op.create_index(
        "ix_system_events_category", "system_events", ["category"], unique=False
    )
    op.create_index(
        "ix_system_events_correlation_id",
        "system_events",
        ["correlation_id"],
        unique=False,
    )
    op.create_index(
        "ix_system_events_user_id", "system_events", ["user_id"], unique=False
    )
    op.create_index(
        "ix_system_events_broker", "system_events", ["broker"], unique=False
    )
    op.create_index(
        "ix_system_events_symbol", "system_events", ["symbol"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_system_events_symbol", table_name="system_events")
    op.drop_index("ix_system_events_broker", table_name="system_events")
    op.drop_index("ix_system_events_user_id", table_name="system_events")
    op.drop_index("ix_system_events_correlation_id", table_name="system_events")
    op.drop_index("ix_system_events_category", table_name="system_events")
    op.drop_index("ix_system_events_level", table_name="system_events")
    op.drop_index("ix_system_events_created_at", table_name="system_events")
    op.drop_table("system_events")

