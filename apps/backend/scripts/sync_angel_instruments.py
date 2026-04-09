from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.db.session import SessionLocal
from app.services.instrument_sync_service import instrument_sync_service


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync Angel instruments into the canonical registry (JSON rows)."
    )
    parser.add_argument("--file", required=True, help="Path to Angel instrument JSON")
    args = parser.parse_args()

    path = Path(args.file)
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise SystemExit("Input JSON must be a list of rows")

    with SessionLocal() as db:
        result = instrument_sync_service.sync_angel_rows(db, rows)
        print(f"Processed={result.processed}")
        print(f"Ingested={result.ingested}")
        print(f"Skipped={result.skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
