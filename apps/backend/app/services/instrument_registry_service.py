from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_
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
            db.commit()
            db.refresh(existing)
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
        db.commit()
        db.refresh(instrument)
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
            db.commit()
            db.refresh(existing)
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
        db.commit()
        db.refresh(mapping)
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
        term = q.strip().lower()
        if not term:
            return []

        qry = db.query(Instrument).filter(Instrument.is_active.is_(True))

        like = f"%{term}%"
        qry = qry.filter(
            or_(
                func.lower(Instrument.display_symbol).like(like),
                func.lower(Instrument.symbol_root).like(like),
                func.lower(func.coalesce(Instrument.underlying, "")).like(like),
            )
        )

        if exchange:
            qry = qry.filter(Instrument.exchange == exchange.value)
        if segment:
            qry = qry.filter(Instrument.segment == segment.value)
        if instrument_type:
            qry = qry.filter(Instrument.instrument_type == instrument_type.value)
        if option_type:
            qry = qry.filter(Instrument.option_type == option_type.value)

        return (
            qry.order_by(Instrument.display_symbol.asc())
            .limit(max(1, min(limit, 100)))
            .all()
        )

    def get_by_canonical_id(self, db: Session, canonical_id: str) -> Instrument | None:
        return (
            db.query(Instrument)
            .filter(Instrument.canonical_id == canonical_id)
            .one_or_none()
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
