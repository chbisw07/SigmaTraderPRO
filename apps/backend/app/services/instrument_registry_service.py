from __future__ import annotations

import re
from datetime import date
from typing import Any

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.brokers.types import BrokerKey
from app.instruments.types import Exchange, InstrumentType, OptionType, Segment
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.services.instrument_normalizer import NormalizedInstrument


class InstrumentRegistryService:
    def upsert_canonical(
        self, db: Session, payload: NormalizedInstrument
    ) -> Instrument:
        existing = (
            db.query(Instrument)
            .filter(Instrument.canonical_id == payload.canonical_id)
            .one_or_none()
        )
        if existing:
            existing.exchange = payload.exchange.value
            existing.segment = payload.segment.value
            existing.instrument_type = payload.instrument_type.value
            existing.symbol_root = payload.symbol_root
            existing.display_symbol = payload.display_symbol
            existing.underlying = payload.underlying
            existing.expiry = payload.expiry
            existing.strike = payload.strike
            existing.option_type = (
                payload.option_type.value if payload.option_type else None
            )
            existing.lot_size = payload.lot_size
            existing.tick_size = payload.tick_size
            existing.isin = payload.isin
            existing.is_active = payload.is_active
            db.flush()
            return existing

        instrument = Instrument(
            canonical_id=payload.canonical_id,
            exchange=payload.exchange.value,
            segment=payload.segment.value,
            instrument_type=payload.instrument_type.value,
            symbol_root=payload.symbol_root,
            display_symbol=payload.display_symbol,
            underlying=payload.underlying,
            expiry=payload.expiry,
            strike=payload.strike,
            option_type=payload.option_type.value if payload.option_type else None,
            lot_size=payload.lot_size,
            tick_size=payload.tick_size,
            isin=payload.isin,
            is_active=payload.is_active,
        )
        db.add(instrument)
        db.flush()
        return instrument

    def upsert_mapping(
        self,
        db: Session,
        *,
        instrument: Instrument,
        broker: BrokerKey,
        broker_instrument_id: str,
        broker_trading_symbol: str | None,
        raw: dict[str, Any] | None,
    ) -> InstrumentMapping:
        existing = (
            db.query(InstrumentMapping)
            .filter(InstrumentMapping.instrument_id == instrument.id)
            .filter(InstrumentMapping.broker_key == broker.value)
            .one_or_none()
        )
        if existing:
            existing.broker_instrument_id = broker_instrument_id
            existing.broker_trading_symbol = broker_trading_symbol
            existing.raw = raw
            existing.is_active = True
            db.flush()
            return existing

        mapping = InstrumentMapping(
            instrument_id=instrument.id,
            broker_key=broker.value,
            broker_instrument_id=broker_instrument_id,
            broker_trading_symbol=broker_trading_symbol,
            raw=raw,
            is_active=True,
        )
        db.add(mapping)
        db.flush()
        return mapping

    def ingest_normalized(
        self, db: Session, normalized: NormalizedInstrument
    ) -> Instrument:
        instrument = self.upsert_canonical(db, normalized)
        self.upsert_mapping(
            db,
            instrument=instrument,
            broker=normalized.broker_key,
            broker_instrument_id=normalized.broker_instrument_id,
            broker_trading_symbol=normalized.broker_trading_symbol,
            raw=normalized.raw,
        )
        return instrument

    def search(
        self,
        db: Session,
        *,
        q: str,
        limit: int = 25,
        exchange: Exchange | None = None,
        segment: Segment | None = None,
        instrument_type: InstrumentType | None = None,
        option_type: OptionType | None = None,
    ) -> list[Instrument]:
        raw = q.strip().lower()
        if not raw:
            return []

        # Tokenized AND search:
        # - "nifty 23" matches instruments containing both tokens
        # - supports filtering by partial strike / expiry (via canonical_id tokens)
        tokens = [t for t in re.findall(r"[a-z0-9]+", raw) if t]
        if not tokens:
            return []

        qry = db.query(Instrument).filter(Instrument.is_active.is_(True))

        for token in tokens:
            like = f"%{token}%"
            qry = qry.filter(
                or_(
                    func.lower(Instrument.display_symbol).like(like),
                    func.lower(Instrument.symbol_root).like(like),
                    func.lower(func.coalesce(Instrument.underlying, "")).like(like),
                    func.lower(Instrument.canonical_id).like(like),
                    func.lower(func.coalesce(Instrument.isin, "")).like(like),
                )
            )

        # Relevance ordering: prefer exact/root matches over substring collisions
        primary = tokens[0]
        priority = case(
            (func.lower(Instrument.symbol_root) == primary, 0),
            (func.lower(func.coalesce(Instrument.underlying, "")) == primary, 1),
            (func.lower(Instrument.display_symbol).like(f"{primary}%"), 2),
            (func.lower(Instrument.symbol_root).like(f"{primary}%"), 3),
            else_=10,
        )

        if exchange:
            qry = qry.filter(Instrument.exchange == exchange.value)
        if segment:
            qry = qry.filter(Instrument.segment == segment.value)
        if instrument_type:
            qry = qry.filter(Instrument.instrument_type == instrument_type.value)
        if option_type:
            qry = qry.filter(Instrument.option_type == option_type.value)

        # Cross-DB friendly "NULLS LAST" emulation for sqlite-backed unit tests.
        expiry_nulls_last = case((Instrument.expiry.is_(None), 1), else_=0)
        strike_nulls_last = case((Instrument.strike.is_(None), 1), else_=0)
        option_type_order = case(
            (Instrument.option_type == "CE", 0),
            (Instrument.option_type == "PE", 1),
            else_=2,
        )

        if instrument_type == InstrumentType.OPTION:
            order_by = [
                priority.asc(),
                expiry_nulls_last.asc(),
                Instrument.expiry.asc(),
                strike_nulls_last.asc(),
                Instrument.strike.asc(),
                option_type_order.asc(),
                Instrument.display_symbol.asc(),
            ]
        elif instrument_type == InstrumentType.FUTURE:
            order_by = [
                priority.asc(),
                expiry_nulls_last.asc(),
                Instrument.expiry.asc(),
                Instrument.display_symbol.asc(),
            ]
        else:
            order_by = [priority.asc(), Instrument.display_symbol.asc()]

        return qry.order_by(*order_by).limit(max(1, min(limit, 100))).all()

    def get_by_canonical_id(self, db: Session, canonical_id: str) -> Instrument | None:
        return (
            db.query(Instrument)
            .filter(Instrument.canonical_id == canonical_id)
            .one_or_none()
        )

    def list_expiries(
        self,
        db: Session,
        *,
        underlying: str,
        exchange: Exchange,
        instrument_type: InstrumentType,
        limit: int = 40,
    ) -> list[date]:
        normalized = underlying.strip().upper()
        if not normalized:
            return []

        qry = (
            db.query(Instrument.expiry)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange.value)
            .filter(Instrument.instrument_type == instrument_type.value)
            .filter(Instrument.underlying == normalized)
            .filter(Instrument.expiry.isnot(None))
            .distinct()
            .order_by(Instrument.expiry.asc())
            .limit(max(1, min(limit, 200)))
        )
        return [row[0] for row in qry.all() if row[0] is not None]

    def list_strikes(
        self,
        db: Session,
        *,
        underlying: str,
        exchange: Exchange,
        expiry: date,
        option_type: OptionType | None = None,
        limit: int = 400,
    ) -> list[float]:
        normalized = underlying.strip().upper()
        if not normalized:
            return []

        qry = (
            db.query(Instrument.strike)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange.value)
            .filter(Instrument.instrument_type == InstrumentType.OPTION.value)
            .filter(Instrument.underlying == normalized)
            .filter(Instrument.expiry == expiry)
            .filter(Instrument.strike.isnot(None))
        )
        if option_type:
            qry = qry.filter(Instrument.option_type == option_type.value)

        qry = (
            qry.distinct()
            .order_by(Instrument.strike.asc())
            .limit(max(1, min(limit, 2000)))
        )

        strikes: list[float] = []
        for row in qry.all():
            strike = row[0]
            if strike is None:
                continue
            try:
                strikes.append(float(strike))
            except Exception:
                continue
        return strikes

    def list_options(
        self,
        db: Session,
        *,
        underlying: str,
        exchange: Exchange,
        expiry: date,
        option_type: OptionType | None = None,
        limit: int = 400,
    ) -> list[Instrument]:
        normalized = underlying.strip().upper()
        if not normalized:
            return []

        qry = (
            db.query(Instrument)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange.value)
            .filter(Instrument.instrument_type == InstrumentType.OPTION.value)
            .filter(Instrument.underlying == normalized)
            .filter(Instrument.expiry == expiry)
        )
        if option_type:
            qry = qry.filter(Instrument.option_type == option_type.value)

        return (
            qry.order_by(Instrument.strike.asc(), Instrument.display_symbol.asc())
            .limit(max(1, min(limit, 2000)))
            .all()
        )

    def resolve_for_broker(
        self, db: Session, *, canonical_id: str, broker: BrokerKey
    ) -> InstrumentMapping | None:
        instrument = self.get_by_canonical_id(db, canonical_id)
        if not instrument:
            return None
        return (
            db.query(InstrumentMapping)
            .filter(InstrumentMapping.instrument_id == instrument.id)
            .filter(InstrumentMapping.broker_key == broker.value)
            .one_or_none()
        )


instrument_registry_service = InstrumentRegistryService()
