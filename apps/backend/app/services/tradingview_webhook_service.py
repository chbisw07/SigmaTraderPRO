from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.schemas.webhook_tradingview import TradingViewNormalizedPayload


class TradingViewWebhookReasonCode:
    WEBHOOK_TOKEN_MISSING = "WEBHOOK_TOKEN_MISSING"
    WEBHOOK_TOKEN_INVALID = "WEBHOOK_TOKEN_INVALID"
    WEBHOOK_SCHEMA_VERSION_MISSING = "WEBHOOK_SCHEMA_VERSION_MISSING"
    WEBHOOK_SCHEMA_VERSION_UNSUPPORTED = "WEBHOOK_SCHEMA_VERSION_UNSUPPORTED"
    WEBHOOK_DUPLICATE = "WEBHOOK_DUPLICATE"
    WEBHOOK_INVALID_PAYLOAD = "WEBHOOK_INVALID_PAYLOAD"


class TradingViewWebhookStatus:
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DUPLICATE_IGNORED = "duplicate_ignored"


def _norm_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _upper(value: Any) -> str | None:
    s = _norm_str(value)
    return s.upper() if s else None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except Exception:  # noqa: BLE001
        return None
    if f < 0:
        return None
    return f


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        i = int(value)
    except Exception:  # noqa: BLE001
        return None
    if i <= 0:
        return None
    return i


def _supported_schema_versions() -> set[str]:
    raw = str(getattr(settings, "tradingview_supported_schema_versions", "1") or "1")
    return {v.strip() for v in raw.split(",") if v.strip()}


def redact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    redacted = dict(payload)
    for key in ["route_token", "token", "secret"]:
        if key in redacted:
            redacted[key] = "***"
    return redacted


def derive_idempotency_key(
    payload: dict[str, Any], *, schema_version: str, namespace: str = "tv"
) -> str:
    candidates = [
        payload.get("idempotency_key"),
        payload.get("alert_id"),
        payload.get("order_id"),
        payload.get("event_id"),
        payload.get("id"),
    ]
    for c in candidates:
        s = _norm_str(c)
        if s:
            return f"{namespace}:{schema_version}:{s}"

    # Stable fingerprint of redacted payload.
    redacted = redact_payload(payload)
    blob = json.dumps(redacted, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(blob).hexdigest()
    return f"{namespace}:{schema_version}:sha256:{digest}"


def validate_route_token(payload: dict[str, Any]) -> tuple[bool, str | None]:
    token = _norm_str(payload.get("route_token"))
    if not token:
        return False, TradingViewWebhookReasonCode.WEBHOOK_TOKEN_MISSING
    expected = getattr(settings, "tradingview_route_token", None)
    if not expected:
        # No configured token means ingestion is disabled in real deployments.
        return False, TradingViewWebhookReasonCode.WEBHOOK_TOKEN_INVALID
    if token != expected:
        return False, TradingViewWebhookReasonCode.WEBHOOK_TOKEN_INVALID
    return True, None


def validate_schema_version(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    schema_version = _norm_str(payload.get("schema_version"))
    if not schema_version:
        return None, TradingViewWebhookReasonCode.WEBHOOK_SCHEMA_VERSION_MISSING
    supported = _supported_schema_versions()
    if schema_version not in supported:
        return None, TradingViewWebhookReasonCode.WEBHOOK_SCHEMA_VERSION_UNSUPPORTED
    return schema_version, None


def _extract_symbol_and_exchange(
    payload: dict[str, Any],
) -> tuple[str | None, str | None]:
    symbol = _norm_str(payload.get("symbol") or payload.get("ticker"))
    exchange = _norm_str(payload.get("exchange"))
    if symbol and ":" in symbol and not exchange:
        # TradingView common symbol shape: "NSE:INFY"
        parts = symbol.split(":", 1)
        if len(parts) == 2 and parts[0] and parts[1]:
            exchange = parts[0].upper()
            symbol = parts[1].upper()
    return (symbol.upper() if symbol else None, exchange.upper() if exchange else None)


def _normalize_action(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    raw = (
        payload.get("order_action")
        or payload.get("action")
        or payload.get("txn_type")
        or payload.get("side")
    )
    action = _upper(raw)
    if action in {"BUY", "SELL"}:
        return "trade", action
    if action in {"LONG"}:
        return "trade", "BUY"
    if action in {"SHORT"}:
        return "trade", "SELL"
    return None, None


@dataclass(frozen=True, slots=True)
class TradingViewNormalizationResult:
    normalized: TradingViewNormalizedPayload | None
    reason_code: str | None
    reason_message: str | None


def normalize_payload(
    payload: dict[str, Any], *, schema_version: str, idempotency_key: str
) -> TradingViewNormalizationResult:
    symbol, exchange = _extract_symbol_and_exchange(payload)
    if not symbol:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="symbol is required",
        )

    action, side = _normalize_action(payload)
    if not action:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="order_action/action/txn_type/side must be BUY or SELL",
        )

    order_type = _upper(payload.get("order_type") or payload.get("type"))
    if order_type and order_type not in {"MARKET", "LIMIT"}:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="order_type must be MARKET or LIMIT",
        )

    product = _upper(payload.get("product"))
    if product and product not in {"CNC", "MIS", "NRML"}:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="product must be CNC, MIS, or NRML",
        )

    instrument_type = _upper(payload.get("instrument_type") or payload.get("segment"))
    if instrument_type:
        aliases = {"EQ": "EQUITY", "FUT": "FUTURE", "OPT": "OPTION"}
        instrument_type = aliases.get(instrument_type, instrument_type)
        if instrument_type not in {"EQUITY", "OPTION", "FUTURE"}:
            return TradingViewNormalizationResult(
                normalized=None,
                reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
                reason_message="instrument_type must be EQUITY, OPTION, or FUTURE",
            )

    underlying = _upper(
        payload.get("underlying") or payload.get("root") or payload.get("base")
    )
    expiry = _norm_str(payload.get("expiry"))
    strike = _as_float(payload.get("strike"))
    option_type = _upper(payload.get("option_type") or payload.get("opt_type"))
    if option_type and option_type not in {"CE", "PE"}:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="option_type must be CE or PE",
        )
    lots = _as_int(payload.get("lots"))
    lot_size = _as_int(payload.get("lot_size") or payload.get("lotsize"))

    qty = _as_int(payload.get("qty") or payload.get("quantity"))
    amount = _as_float(payload.get("amount"))
    price = _as_float(payload.get("price"))

    normalized = TradingViewNormalizedPayload(
        schema_version=schema_version,
        idempotency_key=idempotency_key,
        strategy_id=_norm_str(payload.get("strategy_id") or payload.get("strategyId")),
        strategy_name=_norm_str(
            payload.get("strategy_name")
            or payload.get("strategyName")
            or payload.get("strategy")
        ),
        symbol=symbol,
        exchange=exchange,
        instrument_type=instrument_type,
        underlying=underlying,
        expiry=expiry,
        strike=strike,
        option_type=option_type,
        lots=lots,
        lot_size=lot_size,
        action=action,
        side=side,
        order_type=order_type,
        product=product,
        quantity=qty,
        amount=amount,
        price=price,
        timeframe=_norm_str(payload.get("timeframe") or payload.get("tf")),
        alert_timestamp=_norm_str(
            payload.get("alert_timestamp")
            or payload.get("timestamp")
            or payload.get("time")
        ),
    )

    # Minimal sanity: require either qty or amount for trade actions.
    if normalized.quantity is None and normalized.amount is None:
        return TradingViewNormalizationResult(
            normalized=None,
            reason_code=TradingViewWebhookReasonCode.WEBHOOK_INVALID_PAYLOAD,
            reason_message="qty/quantity or amount is required",
        )

    return TradingViewNormalizationResult(
        normalized=normalized, reason_code=None, reason_message=None
    )
