"""S4.2.1 order intent metadata + positions

Revision ID: 0007_order_intent_and_positions
Revises: 0006_add_orders_lots
Create Date: 2026-04-10

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_order_intent_and_positions"
down_revision = "0006_add_orders_lots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Orders: intent + execution semantics + snapshots (no secrets).
    op.add_column("orders", sa.Column("avg_executed_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("source", sa.String(length=32), nullable=False, server_default="manual_ui"))
    op.add_column("orders", sa.Column("intent_type", sa.String(length=16), nullable=False, server_default="ENTRY"))
    op.add_column("orders", sa.Column("trigger_mode", sa.String(length=16), nullable=False, server_default="MARKET"))
    op.add_column("orders", sa.Column("risk_mode", sa.String(length=16), nullable=True))
    op.add_column("orders", sa.Column("sl_value", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("tp_value", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("trailing_value", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("parent_order_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("linked_position_id", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("broker_context", sa.String(length=50), nullable=True))
    op.add_column("orders", sa.Column("preview_snapshot_json", sa.JSON(), nullable=True))
    op.add_column("orders", sa.Column("broker_payload_json", sa.JSON(), nullable=True))
    op.add_column("orders", sa.Column("broker_symbol_resolved", sa.String(length=128), nullable=True))
    op.add_column("orders", sa.Column("broker_symbol_token_resolved", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("lot_size_snapshot", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("margin_snapshot_json", sa.JSON(), nullable=True))

    op.create_index("ix_orders_source", "orders", ["source"], unique=False)
    op.create_index("ix_orders_intent_type", "orders", ["intent_type"], unique=False)
    op.create_index("ix_orders_trigger_mode", "orders", ["trigger_mode"], unique=False)
    op.create_index("ix_orders_parent_order_id", "orders", ["parent_order_id"], unique=False)
    op.create_index("ix_orders_linked_position_id", "orders", ["linked_position_id"], unique=False)

    # Positions: broker-neutral workspace baseline.
    op.create_table(
        "positions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("broker_key", sa.String(length=50), nullable=False),
        sa.Column("canonical_id", sa.String(length=255), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("lots", sa.Integer(), nullable=True),
        sa.Column("avg_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("last_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("realized_pnl", sa.Numeric(14, 2), nullable=True),
        sa.Column("unrealized_pnl", sa.Numeric(14, 2), nullable=True),
        sa.Column("mtm", sa.Numeric(14, 2), nullable=True),
        sa.Column("broker_position_id", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "broker_key", "canonical_id", name="uq_positions_user_broker_canonical"),
    )
    op.create_index("ix_positions_user_id", "positions", ["user_id"], unique=False)
    op.create_index("ix_positions_broker_key", "positions", ["broker_key"], unique=False)
    op.create_index("ix_positions_canonical_id", "positions", ["canonical_id"], unique=False)

    # Foreign keys (Postgres/MySQL): add after positions exists.
    #
    # SQLite does not support ALTER TABLE ADD CONSTRAINT for foreign keys; tests
    # run migrations on sqlite, so we skip constraints there. (ORM still keeps
    # the relationships future-ready for Postgres dev/prod.)
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_orders_parent_order_id_orders",
            "orders",
            "orders",
            ["parent_order_id"],
            ["id"],
        )
        op.create_foreign_key(
            "fk_orders_linked_position_id_positions",
            "orders",
            "positions",
            ["linked_position_id"],
            ["id"],
        )

    # Remove defaults to keep future writes explicit (but keep existing rows valid).
    # SQLite cannot DROP DEFAULT via ALTER COLUMN, so keep defaults there.
    if bind.dialect.name != "sqlite":
        op.alter_column("orders", "source", server_default=None)
        op.alter_column("orders", "intent_type", server_default=None)
        op.alter_column("orders", "trigger_mode", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.drop_constraint(
            "fk_orders_linked_position_id_positions", "orders", type_="foreignkey"
        )
        op.drop_constraint(
            "fk_orders_parent_order_id_orders", "orders", type_="foreignkey"
        )

    op.drop_index("ix_positions_canonical_id", table_name="positions")
    op.drop_index("ix_positions_broker_key", table_name="positions")
    op.drop_index("ix_positions_user_id", table_name="positions")
    op.drop_table("positions")

    op.drop_index("ix_orders_linked_position_id", table_name="orders")
    op.drop_index("ix_orders_parent_order_id", table_name="orders")
    op.drop_index("ix_orders_trigger_mode", table_name="orders")
    op.drop_index("ix_orders_intent_type", table_name="orders")
    op.drop_index("ix_orders_source", table_name="orders")

    op.drop_column("orders", "margin_snapshot_json")
    op.drop_column("orders", "lot_size_snapshot")
    op.drop_column("orders", "broker_symbol_token_resolved")
    op.drop_column("orders", "broker_symbol_resolved")
    op.drop_column("orders", "broker_payload_json")
    op.drop_column("orders", "preview_snapshot_json")
    op.drop_column("orders", "broker_context")
    op.drop_column("orders", "linked_position_id")
    op.drop_column("orders", "parent_order_id")
    op.drop_column("orders", "trailing_value")
    op.drop_column("orders", "tp_value")
    op.drop_column("orders", "sl_value")
    op.drop_column("orders", "risk_mode")
    op.drop_column("orders", "trigger_mode")
    op.drop_column("orders", "intent_type")
    op.drop_column("orders", "source")
    op.drop_column("orders", "avg_executed_price")
