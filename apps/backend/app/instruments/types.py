from __future__ import annotations

from enum import StrEnum


class Exchange(StrEnum):
    NSE_EQ = "NSE_EQ"
    BSE_EQ = "BSE_EQ"
    NSE_FNO = "NSE_FNO"
    BSE_FNO = "BSE_FNO"
    MCX_FNO = "MCX_FNO"


class Segment(StrEnum):
    EQUITY = "EQUITY"
    FUTURE = "FUTURE"
    OPTION = "OPTION"
    INDEX = "INDEX"
    CURRENCY = "CURRENCY"
    COMMODITY = "COMMODITY"


class InstrumentType(StrEnum):
    EQUITY = "EQUITY"
    ETF = "ETF"
    FUTURE = "FUTURE"
    OPTION = "OPTION"
    INDEX = "INDEX"


class OptionType(StrEnum):
    CE = "CE"
    PE = "PE"
