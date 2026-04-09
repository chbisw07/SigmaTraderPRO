"""S3.1 create broker_connections table

Revision ID: 0003_create_broker_connections
Revises: 0002_create_users
Create Date: 2026-04-09

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_create_broker_connections"
down_revision = "0002_create_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "broker_connections",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("broker_key", sa.String(length=50), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("credentials_enc", sa.Text(), nullable=True),
        sa.Column("session_enc", sa.Text(), nullable=True),
        sa.Column("session_day", sa.Date(), nullable=True),
        sa.Column("last_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "broker_key", name="uq_broker_user_key"),
    )
    op.create_index("ix_broker_connections_user_id", "broker_connections", ["user_id"], unique=False)
    op.create_index("ix_broker_connections_broker_key", "broker_connections", ["broker_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_broker_connections_broker_key", table_name="broker_connections")
    op.drop_index("ix_broker_connections_user_id", table_name="broker_connections")
    op.drop_table("broker_connections")

