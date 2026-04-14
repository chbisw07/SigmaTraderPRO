"""webhook route policy json (TradingView operationalization)

Revision ID: 0017_webhook_routes_policy
Revises: 0016_webhook_routes
Create Date: 2026-04-13

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_webhook_routes_policy"
down_revision = "0016_webhook_routes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "webhook_routes",
        sa.Column("policy_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("webhook_routes", "policy_json")

