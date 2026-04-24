"""Prefix Angel broker instrument ids with exchange segment

Revision ID: 0019_prefix_angel_instrument_ids
Revises: 0018_queue_strategy_metadata
Create Date: 2026-04-15

Angel's public scrip master reuses numeric tokens across exchange segments
(e.g. NSE vs BSE vs NFO/BFO). Our registry previously stored only `token`,
which could violate the unique constraint on (broker_key, broker_instrument_id)
and cause instrument sync failures.

We now store Angel broker instrument ids as `{EXCH_SEG}:{TOKEN}`.
This migration updates existing Angel mappings to the new format.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_prefix_angel_instrument_ids"
down_revision = "0018_queue_strategy_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cross-DB compatible update (SQLite-friendly; no UPDATE..FROM).
    op.execute(
        sa.text(
            """
            UPDATE instrument_mappings
            SET broker_instrument_id = (
                SELECT
                    CASE instruments.exchange
                        WHEN 'NSE_EQ' THEN 'NSE:' || instrument_mappings.broker_instrument_id
                        WHEN 'BSE_EQ' THEN 'BSE:' || instrument_mappings.broker_instrument_id
                        WHEN 'NSE_FNO' THEN 'NFO:' || instrument_mappings.broker_instrument_id
                        WHEN 'BSE_FNO' THEN 'BFO:' || instrument_mappings.broker_instrument_id
                        WHEN 'MCX_FNO' THEN 'MCX:' || instrument_mappings.broker_instrument_id
                        ELSE instrument_mappings.broker_instrument_id
                    END
                FROM instruments
                WHERE instruments.id = instrument_mappings.instrument_id
            )
            WHERE instrument_mappings.broker_key = 'angel'
              AND instrument_mappings.broker_instrument_id NOT LIKE '%:%'
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = getattr(bind, "dialect", None)
    name = getattr(dialect, "name", "") if dialect else ""

    if name == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE instrument_mappings
                SET broker_instrument_id = split_part(broker_instrument_id, ':', 2)
                WHERE broker_key = 'angel'
                  AND broker_instrument_id LIKE '%:%'
                """
            )
        )
        return

    # SQLite / default: strip prefix via instr/substr.
    op.execute(
        sa.text(
            """
            UPDATE instrument_mappings
            SET broker_instrument_id = substr(broker_instrument_id, instr(broker_instrument_id, ':') + 1)
            WHERE broker_key = 'angel'
              AND broker_instrument_id LIKE '%:%'
            """
        )
    )

