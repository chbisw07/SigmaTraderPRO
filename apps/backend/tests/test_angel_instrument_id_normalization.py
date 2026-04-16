from __future__ import annotations

from app.brokers.angel_instrument_id import encode_angel_instrument_id, normalize_angel_exch_seg


def test_normalize_angel_exch_seg_handles_cash_aliases() -> None:
    assert normalize_angel_exch_seg("NSECM") == "NSE"
    assert normalize_angel_exch_seg("BSECM") == "BSE"
    assert normalize_angel_exch_seg("nse_eq") == "NSE"
    assert normalize_angel_exch_seg("bse_eq") == "BSE"


def test_encode_angel_instrument_id_normalizes_segment() -> None:
    assert encode_angel_instrument_id(exch_seg="NSECM", token="1467") == "NSE:1467"
    assert encode_angel_instrument_id(exch_seg="BSECM", token="500112") == "BSE:500112"

