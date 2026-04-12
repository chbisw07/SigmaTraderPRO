"""add execution_intent_json to orders

Revision ID: 0013_add_execution_intent_json
Revises: 0012_webhook_ingestions
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_add_execution_intent_json"
down_revision = "0012_webhook_ingestions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("execution_intent_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "execution_intent_json")
