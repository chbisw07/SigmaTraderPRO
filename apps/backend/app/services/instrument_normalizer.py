from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.brokers.types import BrokerKey
from app.instruments.types import Exchange, InstrumentType, OptionType, Segment


@dataclass(frozen=True, slots=True)
class NormalizedInstrument:
    canonical_id: str
    exchange: Exchange
    segment: Segment
    instrument_type: InstrumentType
    symbol_root: str
    display_symbol: str
    underlying: str | None
    expiry: date | None
    strike: float | None
    option_type: OptionType | None
    lot_size: int | None
    tick_size: float | None
    isin: str | None
    is_active: bool

    broker_key: BrokerKey
    broker_instrument_id: str
    broker_trading_symbol: str | None
    raw: dict[str, Any] | None


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s in {"0", "0.0"}:
        return None
    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            return date.fromisoformat(s)
    except Exception:
        pass
    # Angel commonly uses 25APR2026
    try:
        return datetime.strptime(s.upper(), "%d%b%Y").date()
    except Exception:
        return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(Decimal(s))
    except Exception:
        return None


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return float(Decimal(s))
    except Exception:
        return None


def _guess_option_type(row: dict[str, Any]) -> OptionType | None:
    raw = (row.get("optiontype") or row.get("option_type") or "").strip()
    if raw in {"CE", "PE"}:
        return OptionType(raw)
    sym = str(row.get("symbol") or row.get("tradingsymbol") or "")
    if sym.endswith("CE"):
        return OptionType.CE
    if sym.endswith("PE"):
        return OptionType.PE
    return None


def _display_symbol(
    *,
    instrument_type: InstrumentType,
    symbol_root: str,
    expiry: date | None,
    strike: float | None,
    option_type: OptionType | None,
) -> str:
    if instrument_type == InstrumentType.EQUITY:
        return symbol_root
    if instrument_type == InstrumentType.FUTURE:
        if expiry:
            return f"{symbol_root} {expiry:%d %b %Y} FUT"
        return f"{symbol_root} FUT"
    if instrument_type == InstrumentType.OPTION:
        if expiry and strike is not None and option_type:
            strike_txt = (
                str(int(strike)) if float(strike).is_integer() else f"{strike:g}"
            )
            return f"{symbol_root} {expiry:%d %b %Y} {strike_txt} {option_type.value}"
        return f"{symbol_root} OPT"
    return symbol_root


def _canonical_id(
    *,
    exchange: Exchange,
    segment: Segment,
    instrument_type: InstrumentType,
    symbol_root: str,
    expiry: date | None,
    strike: float | None,
    option_type: OptionType | None,
) -> str:
    root = symbol_root.upper()
    base = f"{exchange.value}:{segment.value}:{instrument_type.value}:{root}"
    if instrument_type == InstrumentType.EQUITY:
        return base
    if expiry:
        base = f"{base}:{expiry.isoformat()}"
    if instrument_type == InstrumentType.OPTION:
        if strike is not None:
            strike_txt = (
                str(int(strike)) if float(strike).is_integer() else f"{strike:g}"
            )
            base = f"{base}:{strike_txt}"
        if option_type:
            base = f"{base}:{option_type.value}"
    return base


def normalize_angel_instrument(row: dict[str, Any]) -> NormalizedInstrument | None:
    exch_seg = str(row.get("exch_seg") or "").strip().upper()
    token = str(row.get("token") or "").strip()
    if not exch_seg or not token:
        return None

    symbol = str(row.get("symbol") or "").strip()
    name = str(row.get("name") or "").strip()
    instrumenttype = str(row.get("instrumenttype") or "").strip().upper()

    expiry = _parse_date(row.get("expiry"))
    strike = _parse_float(row.get("strike"))
    opt_type = _guess_option_type(row)

    lot_size = _parse_int(row.get("lotsize"))
    tick_size = _parse_float(row.get("tick_size") or row.get("tickSize"))
    isin = str(row.get("isin") or "").strip() or None

    # Equity
    if exch_seg in {"NSE", "BSE"} and (
        instrumenttype in {"EQ", "EQUITY"} or "-EQ" in symbol
    ):
        exchange = Exchange.NSE_EQ if exch_seg == "NSE" else Exchange.BSE_EQ
        segment = Segment.EQUITY
        inst_type = InstrumentType.EQUITY
        symbol_root = (symbol.split("-", 1)[0] if symbol else name).strip().upper()
        if not symbol_root:
            return None
        display = _display_symbol(
            instrument_type=inst_type,
            symbol_root=symbol_root,
            expiry=None,
            strike=None,
            option_type=None,
        )
        canonical = _canonical_id(
            exchange=exchange,
            segment=segment,
            instrument_type=inst_type,
            symbol_root=symbol_root,
            expiry=None,
            strike=None,
            option_type=None,
        )
        return NormalizedInstrument(
            canonical_id=canonical,
            exchange=exchange,
            segment=segment,
            instrument_type=inst_type,
            symbol_root=symbol_root,
            display_symbol=display,
            underlying=None,
            expiry=None,
            strike=None,
            option_type=None,
            lot_size=lot_size,
            tick_size=tick_size,
            isin=isin,
            is_active=True,
            broker_key=BrokerKey.angel,
            broker_instrument_id=token,
            broker_trading_symbol=symbol or None,
            raw=row,
        )

    # Derivatives (Angel uses NFO for F&O)
    if exch_seg in {"NFO", "NSEFO", "NFOFO"}:
        exchange = Exchange.NSE_FNO
        if instrumenttype.startswith("FUT"):
            segment = Segment.FUTURE
            inst_type = InstrumentType.FUTURE
        elif instrumenttype.startswith("OPT"):
            segment = Segment.OPTION
            inst_type = InstrumentType.OPTION
        else:
            return None

        symbol_root = (name or symbol).strip().upper()
        if not symbol_root:
            return None

        display = _display_symbol(
            instrument_type=inst_type,
            symbol_root=symbol_root,
            expiry=expiry,
            strike=strike,
            option_type=opt_type,
        )
        canonical = _canonical_id(
            exchange=exchange,
            segment=segment,
            instrument_type=inst_type,
            symbol_root=symbol_root,
            expiry=expiry,
            strike=strike,
            option_type=opt_type,
        )
        return NormalizedInstrument(
            canonical_id=canonical,
            exchange=exchange,
            segment=segment,
            instrument_type=inst_type,
            symbol_root=symbol_root,
            display_symbol=display,
            underlying=symbol_root,
            expiry=expiry,
            strike=strike,
            option_type=opt_type if inst_type == InstrumentType.OPTION else None,
            lot_size=lot_size,
            tick_size=tick_size,
            isin=None,
            is_active=True,
            broker_key=BrokerKey.angel,
            broker_instrument_id=token,
            broker_trading_symbol=symbol or None,
            raw=row,
        )

    return None
