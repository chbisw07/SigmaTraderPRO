from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command


def test_alembic_upgrade_head_sqlite(tmp_path: Path) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))

    db_path = tmp_path / "test.db"
    url = f"sqlite+pysqlite:///{db_path}"
    cfg.set_main_option("sqlalchemy.url", url)

    command.upgrade(cfg, "head")

    engine = create_engine(url, future=True)
    insp = inspect(engine)
    assert "users" in insp.get_table_names()
    assert "broker_connections" in insp.get_table_names()
    assert "instruments" in insp.get_table_names()
    assert "instrument_mappings" in insp.get_table_names()
    assert "orders" in insp.get_table_names()
    assert "positions" in insp.get_table_names()
    assert "system_events" in insp.get_table_names()
    assert "webhook_ingestions" in insp.get_table_names()
    assert "watchlists" in insp.get_table_names()
    assert "watchlist_items" in insp.get_table_names()
    engine.dispose()
