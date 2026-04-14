"""queue strategy/source metadata (TradingView operationalization)

Revision ID: 0018_queue_strategy_metadata
Revises: 0017_webhook_routes_policy
Create Date: 2026-04-13

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_queue_strategy_metadata"
down_revision = "0017_webhook_routes_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingestion_queue_items",
        sa.Column("source_route_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("source_policy_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("source_metadata_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("strategy_name", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("strategy_params_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("signal_price", sa.Float(), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("timeframe", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "ingestion_queue_items",
        sa.Column("signal_timestamp", sa.String(length=64), nullable=True),
    )

    op.create_index(
        "ix_ingestion_queue_items_source_route_id",
        "ingestion_queue_items",
        ["source_route_id"],
        unique=False,
    )
    op.create_index(
        "ix_ingestion_queue_items_strategy_id",
        "ingestion_queue_items",
        ["strategy_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ingestion_queue_items_strategy_id", table_name="ingestion_queue_items"
    )
    op.drop_index(
        "ix_ingestion_queue_items_source_route_id",
        table_name="ingestion_queue_items",
    )

    op.drop_column("ingestion_queue_items", "signal_timestamp")
    op.drop_column("ingestion_queue_items", "timeframe")
    op.drop_column("ingestion_queue_items", "signal_price")
    op.drop_column("ingestion_queue_items", "strategy_params_json")
    op.drop_column("ingestion_queue_items", "strategy_name")
    op.drop_column("ingestion_queue_items", "strategy_id")
    op.drop_column("ingestion_queue_items", "source_metadata_json")
    op.drop_column("ingestion_queue_items", "source_policy_json")
    op.drop_column("ingestion_queue_items", "source_route_id")

