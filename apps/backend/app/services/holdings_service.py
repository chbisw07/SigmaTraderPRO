from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.brokers.base import BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.user import User
from app.schemas.holding import HoldingOut, HoldingsListResponse, HoldingsMeta
from app.schemas.instrument import InstrumentOut
from app.services.broker_service import broker_service


class HoldingsService:
    def _resolve_instrument(
        self,
        db: Session,
        *,
        broker: BrokerKey,
        trading_symbol: str | None,
        isin: str | None,
    ) -> Instrument | None:
        qry = (
            db.query(Instrument)
            .join(InstrumentMapping, InstrumentMapping.instrument_id == Instrument.id)
            .filter(InstrumentMapping.is_active.is_(True))
            .filter(InstrumentMapping.broker_key == broker.value)
        )
        if trading_symbol:
            inst = qry.filter(
                InstrumentMapping.broker_trading_symbol == trading_symbol
            ).one_or_none()
            if inst:
                return inst

        # Fallback: match by ISIN if known.
        if isin:
            return db.query(Instrument).filter(Instrument.isin == isin).one_or_none()
        return None

    def _coerce_int(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _coerce_float(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except Exception:
            return None

    def list(
        self,
        db: Session,
        *,
        user: User,
        broker: str | None = None,
        q: str | None = None,
        limit: int = 500,
    ) -> HoldingsListResponse:
        brokers = [BrokerKey.angel, BrokerKey.zerodha]
        if broker in {BrokerKey.angel.value, BrokerKey.zerodha.value}:
            brokers = [BrokerKey(broker)]

        broker_errors: dict[str, str] = {}
        items: list[HoldingOut] = []

        for b in brokers:
            adapter = broker_service.get_adapter(b)
            fetch = getattr(adapter, "fetch_holdings", None)
            if not callable(fetch):
                broker_errors[b.value] = "Holdings not supported for this broker yet"
                continue

            try:
                rows = fetch(db, user)
            except (BrokerNotConfiguredError, BrokerError) as exc:
                broker_errors[b.value] = str(exc)
                continue
            except Exception:  # noqa: BLE001
                broker_errors[b.value] = "Holdings fetch failed"
                continue

            for row in rows:
                if not isinstance(row, dict):
                    continue
                trading_symbol = (
                    str(row.get("tradingsymbol") or row.get("trading_symbol") or "")
                    .strip()
                    .upper()
                    or None
                )
                exchange = str(row.get("exchange") or "").strip().upper() or None
                isin = str(row.get("isin") or "").strip().upper() or None

                inst = self._resolve_instrument(
                    db,
                    broker=b,
                    trading_symbol=trading_symbol,
                    isin=isin,
                )
                inst_out = (
                    InstrumentOut.model_validate(inst, from_attributes=True)
                    if inst
                    else None
                )

                qty = self._coerce_int(row.get("quantity"))
                t1_qty = self._coerce_int(
                    row.get("t1_quantity") or row.get("t1_quantity") or row.get("t1")
                )

                # Kite often returns `quantity` and `t1_quantity`. Default qty to 0
                # only if missing (we don't fabricate nonzero).
                if qty is None:
                    qty = 0

                avg = self._coerce_float(
                    row.get("average_price") or row.get("avg_price")
                )
                last = self._coerce_float(
                    row.get("last_price") or row.get("ltp") or row.get("last")
                )

                invested = self._coerce_float(row.get("invested_value"))
                if invested is None and avg is not None:
                    invested = float(qty) * float(avg)

                current = self._coerce_float(row.get("current_value"))
                if current is None and last is not None:
                    current = float(qty) * float(last)

                pnl = self._coerce_float(row.get("pnl"))
                if pnl is None and invested is not None and current is not None:
                    pnl = float(current) - float(invested)

                day_change = self._coerce_float(row.get("day_change"))
                day_change_pct = self._coerce_float(
                    row.get("day_change_percentage") or row.get("day_change_pct")
                )

                symbol_display = (
                    inst.display_symbol if inst else (trading_symbol or isin or "—")
                )

                items.append(
                    HoldingOut(
                        row_id=f"h:{b.value}:{trading_symbol or isin or 'na'}",
                        broker=b,
                        canonical_id=(inst.canonical_id if inst else None),
                        instrument=inst_out,
                        symbol_display=symbol_display,
                        exchange=exchange,
                        isin=isin,
                        quantity=qty,
                        t1_quantity=t1_qty,
                        average_price=avg,
                        last_price=last,
                        invested_value=invested,
                        current_value=current,
                        pnl=pnl,
                        day_change=day_change,
                        day_change_percentage=day_change_pct,
                    )
                )

        if q:
            needle = q.strip().upper()

            def _match(i: HoldingOut) -> bool:
                if not needle:
                    return True
                for value in [
                    i.canonical_id,
                    i.symbol_display,
                    i.exchange,
                    i.isin,
                ]:
                    if value and needle in str(value).upper():
                        return True
                return False

            items = [i for i in items if _match(i)]

        # Stable sort: pnl desc (most attention) then symbol.
        items.sort(
            key=lambda r: r.pnl if r.pnl is not None else -(10**18),
            reverse=True,
        )
        items = items[: max(1, min(int(limit), 2000))]

        return HoldingsListResponse(
            items=items,
            meta=HoldingsMeta(broker_errors=broker_errors),
        )


holdings_service = HoldingsService()
