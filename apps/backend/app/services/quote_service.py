from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.base import BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey
from app.core.logger import get_logger, log_event
from app.db.redis_client import get_redis
from app.instruments.types import Exchange
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.user import User
from app.orders.types import BrokerQuoteRequest, ExternalBrokerQuote
from app.services.broker_service import broker_service

logger = get_logger(__name__)


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _redis_key(*, broker: BrokerKey, canonical_id: str) -> str:
    return f"stp:quote:{broker.value}:{canonical_id}"


def _map_exchange_to_broker(exchange: str) -> str | None:
    """
    Map canonical Exchange to broker exchange strings.

    Both Zerodha and Angel use `NSE`/`BSE`/`NFO`/`MCX` conventions.
    """
    try:
        ex = Exchange(exchange)
    except Exception:
        return None
    if ex == Exchange.NSE_EQ:
        return "NSE"
    if ex == Exchange.BSE_EQ:
        return "BSE"
    if ex == Exchange.NSE_FNO:
        return "NFO"
    if ex == Exchange.MCX_FNO:
        return "MCX"
    if ex == Exchange.BSE_FNO:
        # Best-effort; BSE F&O support is broker-specific and may not be enabled.
        return "BFO"
    return None


class QuoteService:
    """
    Bounded on-demand quote snapshots for terminal UI surfaces (Watchlist).

    - Canonical-first: request/response keyed by canonical_id
    - Broker-aware: resolves to broker mappings internally
    - Lean: uses Redis short-lived cache only (per PRD)
    """

    def get_quotes(
        self,
        db: Session,
        user: User,
        *,
        broker: BrokerKey,
        canonical_ids: list[str],
        refresh: bool = False,
        limit: int = 60,
        ttl_seconds: int = 5,
    ) -> tuple[list[ExternalBrokerQuote], str | None]:
        ids = [c.strip() for c in canonical_ids if c and c.strip()]
        if not ids:
            return [], None

        # Hard cap: prevent accidental large requests.
        ids = ids[: max(1, min(limit, 200))]

        redis = None
        try:
            redis = get_redis()
        except Exception:
            redis = None

        cached: dict[str, ExternalBrokerQuote] = {}
        missing: list[str] = []

        if redis and not refresh:
            for cid in ids:
                try:
                    raw = redis.get(_redis_key(broker=broker, canonical_id=cid))
                except Exception:
                    raw = None
                if not raw:
                    missing.append(cid)
                    continue
                try:
                    data = json.loads(raw)
                    cached[cid] = ExternalBrokerQuote(
                        broker=broker.value,
                        canonical_id=str(data.get("canonical_id") or cid),
                        trading_symbol=data.get("trading_symbol"),
                        last_price=data.get("last_price"),
                        previous_close=data.get("previous_close"),
                        change=data.get("change"),
                        change_percent=data.get("change_percent"),
                        as_of=datetime.fromisoformat(str(data.get("as_of")))
                        if data.get("as_of")
                        else None,
                    )
                except Exception:
                    missing.append(cid)

        else:
            missing = ids

        if not missing:
            return [cached[cid] for cid in ids if cid in cached], None

        rows = (
            db.query(Instrument, InstrumentMapping)
            .join(InstrumentMapping, InstrumentMapping.instrument_id == Instrument.id)
            .filter(Instrument.canonical_id.in_(missing))
            .filter(InstrumentMapping.is_active.is_(True))
            .filter(InstrumentMapping.broker_key == broker.value)
            .all()
        )

        requests: list[BrokerQuoteRequest] = []
        for inst, mapping in rows:
            exchange = _map_exchange_to_broker(inst.exchange)
            if not exchange:
                continue
            requests.append(
                BrokerQuoteRequest(
                    canonical_id=inst.canonical_id,
                    exchange=exchange,
                    trading_symbol=mapping.broker_trading_symbol,
                    broker_instrument_id=mapping.broker_instrument_id,
                )
            )

        adapter = broker_service.get_adapter(broker)
        fetched: list[ExternalBrokerQuote] = []
        broker_error: str | None = None
        try:
            fetched = adapter.fetch_quotes(db, user, requests=requests)
        except (BrokerNotConfiguredError, BrokerError) as exc:
            broker_error = str(exc)
        except Exception:  # noqa: BLE001
            broker_error = f"{broker.value} quote fetch failed"

        if broker_error:
            log_event(
                logger,
                "quotes.fetch_failed",
                event_type="market_data",
                category="quotes",
                broker=broker.value,
                error=broker_error[:240],
            )

        if fetched and redis:
            for q in fetched:
                try:
                    payload = {
                        "canonical_id": q.canonical_id,
                        "trading_symbol": q.trading_symbol,
                        "last_price": q.last_price,
                        "previous_close": q.previous_close,
                        "change": q.change,
                        "change_percent": q.change_percent,
                        "as_of": (q.as_of or _now_utc()).isoformat(),
                    }
                    redis.set(
                        _redis_key(broker=broker, canonical_id=q.canonical_id),
                        json.dumps(payload),
                        ex=max(1, int(ttl_seconds)),
                    )
                except Exception:
                    continue

        # Merge cached + fetched, prefer fetched for conflicts.
        merged: dict[str, ExternalBrokerQuote] = {**cached}
        for q in fetched:
            merged[q.canonical_id] = q

        # Return in requested order where available.
        return [merged[cid] for cid in ids if cid in merged], broker_error


quote_service = QuoteService()
