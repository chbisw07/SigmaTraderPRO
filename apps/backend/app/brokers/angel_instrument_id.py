from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AngelInstrumentId:
    exch_seg: str | None
    token: str


_EXCH_NORMALIZE: dict[str, str] = {
    "NSEFO": "NFO",
    "NFOFO": "NFO",
    "NSE_FNO": "NFO",
    "BSE_FNO": "BFO",
}


def normalize_angel_exch_seg(exch_seg: str | None) -> str | None:
    if exch_seg is None:
        return None
    raw = str(exch_seg).strip().upper()
    if not raw:
        return None
    return _EXCH_NORMALIZE.get(raw, raw)


def encode_angel_instrument_id(*, exch_seg: str | None, token: str | None) -> str | None:
    seg = normalize_angel_exch_seg(exch_seg)
    tok = str(token or "").strip()
    if not seg or not tok:
        return None
    return f"{seg}:{tok}"


def decode_angel_instrument_id(value: str | None) -> AngelInstrumentId | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if ":" not in raw:
        return AngelInstrumentId(exch_seg=None, token=raw)
    seg, tok = raw.split(":", 1)
    seg_n = normalize_angel_exch_seg(seg)
    tok_n = tok.strip()
    if not tok_n:
        return None
    return AngelInstrumentId(exch_seg=seg_n, token=tok_n)

