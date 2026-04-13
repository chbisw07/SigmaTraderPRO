from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from app.brokers.types import BrokerKey
from app.instruments.types import InstrumentType, OptionType
from app.models.ingestion_queue_item import IngestionQueueItem
from app.models.instrument import Instrument
from app.models.user import User
from app.orders.types import OrderSide, OrderSource, OrderType
from app.schemas.execution_intent import ExecutionIntent, ProductMode
from app.schemas.ingestion_queue import (
    QueueExecutionMode,
    QueueSourceType,
    QueueStatus,
    QueueValidationState,
)
from app.services.dispatch_gating_service import dispatch_gating_service
from app.services.instrument_registry_service import instrument_registry_service
from app.services.order_service import (
    OrderDependencyError,
    OrderValidationError,
    order_service,
)
from app.services.system_events_service import (
    SystemEventLevel,
    system_events_service,
)


class QueueError(RuntimeError):
    pass


class QueueValidationError(ValueError):
    pass


UNRESOLVED_SENTINEL = "__unresolved__"


@dataclass(frozen=True, slots=True)
class QueueValidationResult:
    state: QueueValidationState
    reason_code: str | None = None
    reason_message: str | None = None


@dataclass(frozen=True, slots=True)
class QueueResolution:
    """
    Resolution snapshot stored on a queue item.

    `execution_ready` means the entry intent is fully resolvable to a strict
    `ExecutionIntent` and can be considered for dispatch gating.
    """

    state: str
    execution_ready: bool
    unresolved_fields: list[str]
    defaulted_fields: list[str]
    invalid_fields: list[str]
    reason_code: str | None
    reason_message: str | None
    intent_json: dict
    instrument_hint: dict


def _intent_summary(intent: ExecutionIntent) -> dict:
    return {
        "broker": intent.entry.broker.value,
        "canonical_id": intent.entry.canonical_id,
        "side": intent.entry.side.value,
        "quantity": int(intent.entry.quantity),
        "lots": int(intent.entry.lots) if intent.entry.lots is not None else None,
        "product": intent.entry.product.value,
        "order_type": intent.entry.order_type.value,
        "limit_price": intent.entry.limit_price,
        "managed_exits": bool(intent.plan.managed_exits),
    }


def _intent_summary_json(intent_json: dict) -> dict:
    entry = (
        intent_json.get("entry", {})
        if isinstance(intent_json.get("entry"), dict)
        else {}
    )
    plan = (
        intent_json.get("plan", {}) if isinstance(intent_json.get("plan"), dict) else {}
    )
    return {
        "broker": entry.get("broker"),
        "canonical_id": entry.get("canonical_id"),
        "side": entry.get("side"),
        "quantity": entry.get("quantity"),
        "lots": entry.get("lots"),
        "product": entry.get("product"),
        "order_type": entry.get("order_type"),
        "limit_price": entry.get("limit_price"),
        "managed_exits": bool(plan.get("managed_exits") or False),
    }


def validate_execution_intent(intent: ExecutionIntent) -> QueueValidationResult:
    entry = intent.entry
    if entry.quantity <= 0:
        return QueueValidationResult(
            state=QueueValidationState.blocked,
            reason_code="INTENT_QUANTITY_INVALID",
            reason_message="Quantity must be >= 1",
        )
    if entry.order_type == OrderType.LIMIT and not entry.limit_price:
        return QueueValidationResult(
            state=QueueValidationState.blocked,
            reason_code="INTENT_LIMIT_PRICE_MISSING",
            reason_message="Limit price is required for LIMIT orders",
        )
    if (
        entry.order_type == OrderType.LIMIT
        and entry.limit_price is not None
        and entry.limit_price <= 0
    ):
        return QueueValidationResult(
            state=QueueValidationState.blocked,
            reason_code="INTENT_LIMIT_PRICE_INVALID",
            reason_message="Limit price must be > 0",
        )
    if intent.plan.managed_exits:
        if intent.plan.reference_price is None or intent.plan.reference_price <= 0:
            return QueueValidationResult(
                state=QueueValidationState.blocked,
                reason_code="PLAN_REFERENCE_MISSING",
                reason_message="Managed exits require a reference price",
            )
        ref = float(intent.plan.reference_price)
        sl = intent.plan.stop_loss.price
        tp = intent.plan.target.price
        if sl is not None:
            if entry.side == OrderSide.BUY and sl >= ref:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_SL_INVALID",
                    reason_message="Stop loss must be below reference for BUY",
                )
            if entry.side == OrderSide.SELL and sl <= ref:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_SL_INVALID",
                    reason_message="Stop loss must be above reference for SELL",
                )
        if tp is not None:
            if entry.side == OrderSide.BUY and tp <= ref:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_TP_INVALID",
                    reason_message="Target must be above reference for BUY",
                )
            if entry.side == OrderSide.SELL and tp >= ref:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_TP_INVALID",
                    reason_message="Target must be below reference for SELL",
                )
        if intent.plan.trailing_sl.enabled:
            dist = intent.plan.trailing_sl.distance.price
            pct = intent.plan.trailing_sl.distance.pct
            if dist is not None and dist <= 0:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_TRAIL_INVALID",
                    reason_message="Trailing SL distance must be > 0",
                )
            if pct is not None and pct >= 0:
                return QueueValidationResult(
                    state=QueueValidationState.blocked,
                    reason_code="PLAN_TRAIL_INVALID",
                    reason_message=(
                        "Trailing SL percent should be negative (protective)"
                    ),
                )

    # Baseline: no warning-only rules yet.
    return QueueValidationResult(state=QueueValidationState.valid)


def _product_mode_for_product(product: str) -> str | None:
    p = str(product or "").upper()
    if p == "CNC":
        return ProductMode.delivery.value
    if p == "MIS":
        return ProductMode.intraday.value
    if p == "NRML":
        return ProductMode.carry_forward.value
    return None


def _ensure_intent_shape(intent_json: dict) -> dict:
    out = dict(intent_json or {})
    if not isinstance(out.get("entry"), dict):
        out["entry"] = {}
    if not isinstance(out.get("plan"), dict):
        out["plan"] = {}
    plan = out["plan"]
    if not isinstance(plan.get("stop_loss"), dict):
        plan["stop_loss"] = {"price": None, "pct": None}
    if not isinstance(plan.get("target"), dict):
        plan["target"] = {"price": None, "pct": None}
    if not isinstance(plan.get("trailing_sl"), dict):
        plan["trailing_sl"] = {
            "enabled": False,
            "distance": {"price": None, "pct": None},
        }
    return out


def _coerce_side(value: object) -> str | None:
    v = str(value or "").strip().upper()
    return v if v in {"BUY", "SELL"} else None


def _coerce_order_type(value: object) -> str | None:
    v = str(value or "").strip().upper()
    return v if v in {"MARKET", "LIMIT"} else None


def _coerce_product(value: object) -> str | None:
    v = str(value or "").strip().upper()
    return v if v in {"CNC", "MIS", "NRML"} else None


def _coerce_broker(value: object) -> str | None:
    v = str(value or "").strip().lower()
    return v if v in {"angel", "zerodha"} else None


def _coerce_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        i = int(value)
    except Exception:
        return None
    return i if i > 0 else None


def _coerce_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except Exception:
        return None
    return f if f >= 0 else None


def _extract_instrument_hint(intent_json: dict) -> dict:
    entry = (
        intent_json.get("entry", {})
        if isinstance(intent_json.get("entry"), dict)
        else {}
    )
    hint = entry.get("instrument_hint") or {}
    if not isinstance(hint, dict):
        hint = {}
    keys = [
        "symbol",
        "exchange",
        "instrument_type",
        "underlying",
        "expiry",
        "strike",
        "option_type",
    ]
    return {k: hint.get(k) for k in keys if hint.get(k) is not None}


def _parse_iso_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return None


def _map_exchange_hint(value: object) -> str | None:
    ex = str(value or "").strip().upper()
    if not ex:
        return None
    if ex in {"NSE", "NSE_EQ"}:
        return "NSE_EQ"
    if ex in {"BSE", "BSE_EQ"}:
        return "BSE_EQ"
    if ex in {"NFO", "NSE_FNO"}:
        return "NSE_FNO"
    if ex in {"BFO", "BSE_FNO"}:
        return "BSE_FNO"
    return None


def _try_resolve_canonical_id_from_hint(db: Session, hint: dict) -> str | None:
    symbol = str(hint.get("symbol") or "").strip().upper()
    exchange_hint = _map_exchange_hint(hint.get("exchange"))
    inst_type = str(hint.get("instrument_type") or "").strip().upper()

    # Equity: exchange + symbol.
    if exchange_hint in {"NSE_EQ", "BSE_EQ"} and symbol:
        inst = (
            db.query(Instrument)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange_hint)
            .filter(Instrument.segment == "EQUITY")
            .filter(
                (Instrument.symbol_root == symbol)
                | (Instrument.display_symbol == symbol)
            )
            .one_or_none()
        )
        return inst.canonical_id if inst else None

    # Derivatives require structured hints.
    if exchange_hint not in {"NSE_FNO", "BSE_FNO"}:
        return None

    underlying = str(hint.get("underlying") or symbol or "").strip().upper()
    expiry = _parse_iso_date(hint.get("expiry"))
    strike = _coerce_float(hint.get("strike"))
    opt_type = str(hint.get("option_type") or "").strip().upper() or None

    if inst_type == "OPTION":
        if not (
            underlying and expiry and strike is not None and opt_type in {"CE", "PE"}
        ):
            return None
        inst = (
            db.query(Instrument)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange_hint)
            .filter(Instrument.instrument_type == "OPTION")
            .filter(
                (Instrument.underlying == underlying)
                | (Instrument.symbol_root == underlying)
            )
            .filter(Instrument.expiry == expiry)
            .filter(func.abs(Instrument.strike - float(strike)) < 0.0001)
            .filter(Instrument.option_type == opt_type)
            .one_or_none()
        )
        return inst.canonical_id if inst else None

    if inst_type == "FUTURE":
        if not (underlying and expiry):
            return None
        inst = (
            db.query(Instrument)
            .filter(Instrument.is_active.is_(True))
            .filter(Instrument.exchange == exchange_hint)
            .filter(Instrument.instrument_type == "FUTURE")
            .filter(
                (Instrument.underlying == underlying)
                | (Instrument.symbol_root == underlying)
            )
            .filter(Instrument.expiry == expiry)
            .one_or_none()
        )
        return inst.canonical_id if inst else None

    return None


def _compute_resolution(
    db: Session,
    *,
    intent_json: dict,
    source_type: QueueSourceType,
    default_broker_key: str | None = None,
    default_product: str | None = None,
    default_order_type: str | None = None,
) -> QueueResolution:
    intent_json = _ensure_intent_shape(intent_json)
    entry = intent_json["entry"]
    plan = intent_json["plan"]

    unresolved: list[str] = []
    defaulted: list[str] = []
    invalid: list[str] = []

    side = _coerce_side(entry.get("side"))
    if not side:
        unresolved.append("entry.side")
    else:
        entry["side"] = side

    broker = _coerce_broker(entry.get("broker"))
    if not broker and default_broker_key:
        broker = _coerce_broker(default_broker_key)
        if broker:
            entry["broker"] = broker
            defaulted.append("entry.broker")
    if not broker:
        unresolved.append("entry.broker")

    canonical_id = str(entry.get("canonical_id") or "").strip()
    instrument_hint = _extract_instrument_hint(intent_json)
    if not canonical_id:
        resolved = _try_resolve_canonical_id_from_hint(db, instrument_hint)
        if resolved:
            canonical_id = resolved
            entry["canonical_id"] = canonical_id
            defaulted.append("entry.canonical_id")
    if not canonical_id:
        unresolved.append("entry.canonical_id")
    else:
        inst = instrument_registry_service.get_by_canonical_id(db, canonical_id)
        if not inst:
            invalid.append("entry.canonical_id")

    product = _coerce_product(entry.get("product"))
    if not product and default_product:
        product = _coerce_product(default_product)
        if product:
            entry["product"] = product
            defaulted.append("entry.product")
    if not product:
        unresolved.append("entry.product")

    product_mode = str(entry.get("product_mode") or "").strip()
    if not product_mode and product:
        pm = _product_mode_for_product(product)
        if pm:
            entry["product_mode"] = pm
            defaulted.append("entry.product_mode")

    order_type = _coerce_order_type(entry.get("order_type"))
    if not order_type and default_order_type:
        order_type = _coerce_order_type(default_order_type)
        if order_type:
            entry["order_type"] = order_type
            defaulted.append("entry.order_type")
    if not order_type:
        unresolved.append("entry.order_type")

    limit_price = _coerce_float(entry.get("limit_price"))
    if order_type == "LIMIT":
        if limit_price is None or limit_price <= 0:
            unresolved.append("entry.limit_price")
        else:
            entry["limit_price"] = limit_price
    else:
        entry["limit_price"] = None

    qty = _coerce_int(entry.get("quantity"))
    lots = _coerce_int(entry.get("lots"))
    lot_size = _coerce_int(entry.get("lot_size"))
    if qty is None and lots and lot_size:
        entry["quantity"] = int(lots) * int(lot_size)
        qty = entry["quantity"]
        defaulted.append("entry.quantity")
    if qty is None:
        unresolved.append("entry.quantity")
    else:
        entry["quantity"] = qty

    managed_exits = bool(plan.get("managed_exits") or False)
    if managed_exits:
        ref = _coerce_float(plan.get("reference_price"))
        if not ref or ref <= 0:
            unresolved.append("plan.reference_price")
        else:
            plan["reference_price"] = ref

    if lots is not None and lots <= 0:
        invalid.append("entry.lots")
    if lot_size is not None and lot_size <= 0:
        invalid.append("entry.lot_size")

    # Broker-specific instrument mapping must exist before execution.
    if broker and canonical_id and "entry.canonical_id" not in unresolved:
        try:
            mapping = instrument_registry_service.resolve_for_broker(
                db, canonical_id=canonical_id, broker=BrokerKey(broker)
            )
        except Exception:
            mapping = None
        if not mapping:
            unresolved.append("instrument.broker_mapping")

    execution_ready = len(unresolved) == 0 and len(invalid) == 0
    state = "resolved" if execution_ready else "unresolved"

    reason_code: str | None = None
    reason_message: str | None = None
    if not execution_ready:
        if "entry.canonical_id" in invalid:
            reason_code = "INSTRUMENT_INVALID"
            reason_message = "Instrument is invalid"
        elif "entry.broker" in unresolved:
            reason_code = "BROKER_UNRESOLVED"
            reason_message = "Broker not resolved"
        elif "entry.canonical_id" in unresolved:
            reason_code = "INSTRUMENT_UNRESOLVED"
            reason_message = "Instrument not resolved"
        elif "instrument.broker_mapping" in unresolved:
            reason_code = "INSTRUMENT_MAPPING_MISSING"
            reason_message = "Instrument not mapped for broker"
        elif "entry.product" in unresolved:
            reason_code = "PRODUCT_UNRESOLVED"
            reason_message = "Product not resolved"
        elif "entry.order_type" in unresolved:
            reason_code = "ORDER_TYPE_UNRESOLVED"
            reason_message = "Order type not resolved"
        elif "entry.quantity" in unresolved:
            reason_code = "QUANTITY_UNRESOLVED"
            reason_message = "Quantity not resolved"
        elif "entry.limit_price" in unresolved:
            reason_code = "LIMIT_PRICE_UNRESOLVED"
            reason_message = "Limit price required for LIMIT orders"
        elif "plan.reference_price" in unresolved:
            reason_code = "PLAN_REFERENCE_UNRESOLVED"
            reason_message = "Managed exits require a reference price"
        else:
            reason_code = "UNRESOLVED_FIELDS"
            reason_message = "Queue item requires resolution"

    return QueueResolution(
        state=state,
        execution_ready=execution_ready,
        unresolved_fields=unresolved,
        defaulted_fields=defaulted,
        invalid_fields=invalid,
        reason_code=reason_code,
        reason_message=reason_message,
        intent_json=intent_json,
        instrument_hint=instrument_hint,
    )


def _queue_message(kind: str, *, item: IngestionQueueItem) -> str:
    if kind == "created":
        return f"Queue item created: {item.source_type}"
    if kind == "blocked":
        reason = (
            item.block_reason_message or item.block_reason_code or "not dispatchable"
        )
        return f"Queue item blocked: {reason}"
    if kind == "cancelled":
        return "Queue item cancelled"
    if kind == "executing":
        return "Queue item execution started"
    if kind == "dispatched":
        return "Queue item dispatched to broker"
    if kind == "failed":
        reason = (
            item.block_reason_message or item.block_reason_code or "dispatch failed"
        )
        return f"Queue item execution failed: {reason}"
    return "Queue event"


def _order_source_for_queue_item(item: IngestionQueueItem) -> OrderSource:
    """
    Map queue source_type to order source for downstream auditability.

    Baseline mapping:
      - manual_ui -> manual_ui
      - tradingview -> tv_webhook
      - others -> manual_ui (until additional OrderSource values exist)
    """
    if item.source_type == QueueSourceType.tradingview.value:
        return OrderSource.tv_webhook
    return OrderSource.manual_ui


class IngestionQueueService:
    def create_item(
        self,
        db: Session,
        *,
        user: User,
        source_type: QueueSourceType,
        source_ref: str | None,
        execution_mode: QueueExecutionMode,
        correlation_id: str | None,
        idempotency_key: str | None,
        intent_json: dict,
        notes: str | None,
        expires_at: datetime | None,
        default_broker_key: str | None = None,
        default_product: str | None = None,
        default_order_type: str | None = None,
    ) -> IngestionQueueItem:
        corr = correlation_id or str(uuid4())
        idem = idempotency_key or str(uuid4())

        resolution = _compute_resolution(
            db,
            intent_json=intent_json,
            source_type=source_type,
            default_broker_key=default_broker_key,
            default_product=default_product,
            default_order_type=default_order_type,
        )

        status: QueueStatus = (
            QueueStatus.queued
            if resolution.execution_ready
            and execution_mode == QueueExecutionMode.auto_dispatch
            else QueueStatus.ready
            if resolution.execution_ready
            else QueueStatus.blocked
        )
        validation_state = (
            QueueValidationState.valid
            if resolution.execution_ready
            else QueueValidationState.blocked
        )

        item = IngestionQueueItem(
            user_id=user.id,
            source_type=source_type.value,
            source_ref=source_ref,
            correlation_id=corr,
            idempotency_key=idem,
            broker_key=_coerce_broker(resolution.intent_json["entry"].get("broker"))
            or UNRESOLVED_SENTINEL,
            canonical_id=str(
                resolution.intent_json["entry"].get("canonical_id")
                or UNRESOLVED_SENTINEL
            ),
            execution_mode=execution_mode.value,
            status=status.value,
            validation_state=validation_state.value,
            block_reason_code=resolution.reason_code,
            block_reason_message=resolution.reason_message,
            execution_intent_json=resolution.intent_json,
            resolution_state=resolution.state,
            resolution_json={
                "execution_ready": resolution.execution_ready,
                "unresolved_fields": resolution.unresolved_fields,
                "defaulted_fields": resolution.defaulted_fields,
                "invalid_fields": resolution.invalid_fields,
                "instrument_hint": resolution.instrument_hint,
            },
            dispatched_order_id=None,
            notes=notes,
            expires_at=expires_at,
        )
        db.add(item)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            existing = (
                db.query(IngestionQueueItem)
                .filter(IngestionQueueItem.user_id == user.id)
                .filter(IngestionQueueItem.idempotency_key == idem)
                .one_or_none()
            )
            if existing and source_type != QueueSourceType.manual_ui:
                return existing
            raise QueueError("Duplicate idempotency_key") from exc
        db.refresh(item)

        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="ingestion_queue",
            message=_queue_message("created", item=item),
            correlation_id=item.correlation_id,
            user_id=user.id,
            broker=item.broker_key,
            symbol=None,
            metadata={
                "queue_id": item.id,
                "source_type": item.source_type,
                "execution_mode": item.execution_mode,
                **_intent_summary_json(resolution.intent_json),
            },
        )
        if not resolution.execution_ready:
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="ingestion_queue",
                message=_queue_message("blocked", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={
                    "queue_id": item.id,
                    "reason_code": item.block_reason_code,
                    "unresolved_fields": resolution.unresolved_fields,
                },
            )

        # Auto-dispatch (baseline synchronous).
        if (
            execution_mode == QueueExecutionMode.auto_dispatch
            and resolution.execution_ready
            and status != QueueStatus.blocked
        ):
            self.execute_item(db, user=user, item_id=item.id)
            db.refresh(item)

        return item

    def list_items(
        self,
        db: Session,
        *,
        user: User,
        status: str | None,
        resolution_state: str | None,
        source_type: str | None,
        broker: str | None,
        q: str | None,
        limit: int,
    ) -> list[tuple[IngestionQueueItem, Instrument | None]]:
        qry = (
            db.query(IngestionQueueItem, Instrument)
            .outerjoin(
                Instrument, Instrument.canonical_id == IngestionQueueItem.canonical_id
            )
            .filter(IngestionQueueItem.user_id == user.id)
        )
        if status:
            qry = qry.filter(IngestionQueueItem.status == status)
        if resolution_state:
            qry = qry.filter(IngestionQueueItem.resolution_state == resolution_state)
        if source_type:
            qry = qry.filter(IngestionQueueItem.source_type == source_type)
        if broker:
            qry = qry.filter(IngestionQueueItem.broker_key == broker)
        if q:
            like = f"%{q.strip()}%"
            qry = qry.filter(
                (IngestionQueueItem.canonical_id.ilike(like))
                | (Instrument.display_symbol.ilike(like))
            )
        return qry.order_by(IngestionQueueItem.created_at.desc()).limit(limit).all()

    def get_item(self, db: Session, *, user: User, item_id: int) -> IngestionQueueItem:
        item = (
            db.query(IngestionQueueItem)
            .filter(IngestionQueueItem.user_id == user.id)
            .filter(IngestionQueueItem.id == item_id)
            .one_or_none()
        )
        if not item:
            raise QueueError("Queue item not found")
        return item

    def update_item(
        self,
        db: Session,
        *,
        user: User,
        item_id: int,
        execution_mode: QueueExecutionMode | None,
        intent_json: dict | None,
        notes: str | None,
        expires_at: datetime | None,
    ) -> IngestionQueueItem:
        item = self.get_item(db, user=user, item_id=item_id)
        if item.status in {QueueStatus.cancelled.value, QueueStatus.dispatched.value}:
            raise QueueError("Cannot edit a final queue item")

        if execution_mode is not None:
            item.execution_mode = execution_mode.value
        if intent_json is not None:
            source = QueueSourceType(item.source_type)
            resolution = _compute_resolution(
                db, intent_json=intent_json, source_type=source
            )
            item.execution_intent_json = resolution.intent_json
            item.broker_key = (
                _coerce_broker(resolution.intent_json["entry"].get("broker"))
                or UNRESOLVED_SENTINEL
            )
            item.canonical_id = str(
                resolution.intent_json["entry"].get("canonical_id")
                or UNRESOLVED_SENTINEL
            )
            item.validation_state = (
                QueueValidationState.valid.value
                if resolution.execution_ready
                else QueueValidationState.blocked.value
            )
            item.block_reason_code = resolution.reason_code
            item.block_reason_message = resolution.reason_message
            item.resolution_state = resolution.state
            item.resolution_json = {
                "execution_ready": resolution.execution_ready,
                "unresolved_fields": resolution.unresolved_fields,
                "defaulted_fields": resolution.defaulted_fields,
                "invalid_fields": resolution.invalid_fields,
                "instrument_hint": resolution.instrument_hint,
                "manually_edited": True,
            }
            if resolution.execution_ready:
                item.status = (
                    QueueStatus.queued.value
                    if item.execution_mode == QueueExecutionMode.auto_dispatch.value
                    else QueueStatus.ready.value
                )
                item.block_reason_code = None
                item.block_reason_message = None
            else:
                item.status = QueueStatus.blocked.value
        if notes is not None:
            item.notes = notes
        if expires_at is not None:
            item.expires_at = expires_at

        db.commit()
        db.refresh(item)
        return item

    def resolve_item_fields(
        self,
        db: Session,
        *,
        user: User,
        item_id: int,
        broker: str | None,
        canonical_id: str | None,
        product: str | None,
        order_type: str | None,
        quantity: int | None,
        limit_price: float | None,
        instrument_hint: dict | None,
    ) -> IngestionQueueItem:
        item = self.get_item(db, user=user, item_id=item_id)
        if item.status in {QueueStatus.cancelled.value, QueueStatus.dispatched.value}:
            raise QueueError("Cannot resolve a final queue item")

        intent_json = _ensure_intent_shape(item.execution_intent_json)
        entry = intent_json["entry"]
        if broker is not None:
            entry["broker"] = broker
        if canonical_id is not None:
            entry["canonical_id"] = canonical_id
        if product is not None:
            entry["product"] = product
        if order_type is not None:
            entry["order_type"] = order_type
        if quantity is not None:
            entry["quantity"] = int(quantity)
        if limit_price is not None:
            entry["limit_price"] = float(limit_price)
        if instrument_hint is not None:
            entry["instrument_hint"] = instrument_hint

        before_ready = bool((item.resolution_json or {}).get("execution_ready"))
        out = self.update_item(
            db,
            user=user,
            item_id=item_id,
            execution_mode=None,
            intent_json=intent_json,
            notes=None,
            expires_at=None,
        )
        after_ready = bool((out.resolution_json or {}).get("execution_ready"))
        if not before_ready and after_ready:
            system_events_service.emit(
                db,
                level=SystemEventLevel.INFO,
                category="ingestion_queue",
                message="Queue item ready after resolution",
                correlation_id=out.correlation_id,
                user_id=user.id,
                broker=out.broker_key,
                symbol=None,
                metadata={"queue_id": out.id},
            )
        return out

    def cancel_item(
        self, db: Session, *, user: User, item_id: int
    ) -> IngestionQueueItem:
        item = self.get_item(db, user=user, item_id=item_id)
        if item.status in {QueueStatus.cancelled.value, QueueStatus.dispatched.value}:
            return item
        item.status = QueueStatus.cancelled.value
        db.commit()
        db.refresh(item)
        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="ingestion_queue",
            message=_queue_message("cancelled", item=item),
            correlation_id=item.correlation_id,
            user_id=user.id,
            broker=item.broker_key,
            symbol=None,
            metadata={"queue_id": item.id},
        )
        return item

    def execute_item(
        self, db: Session, *, user: User, item_id: int
    ) -> IngestionQueueItem:
        item = self.get_item(db, user=user, item_id=item_id)
        if item.status in {QueueStatus.cancelled.value, QueueStatus.dispatched.value}:
            return item

        if item.expires_at and datetime.now(tz=UTC) > item.expires_at:
            item.status = QueueStatus.expired.value
            db.commit()
            db.refresh(item)
            return item

        source = QueueSourceType(item.source_type)
        resolution = _compute_resolution(
            db, intent_json=item.execution_intent_json, source_type=source
        )
        item.execution_intent_json = resolution.intent_json
        item.broker_key = (
            _coerce_broker(resolution.intent_json["entry"].get("broker"))
            or item.broker_key
            or UNRESOLVED_SENTINEL
        )
        item.canonical_id = str(
            resolution.intent_json["entry"].get("canonical_id")
            or item.canonical_id
            or UNRESOLVED_SENTINEL
        )
        item.resolution_state = resolution.state
        item.resolution_json = {
            "execution_ready": resolution.execution_ready,
            "unresolved_fields": resolution.unresolved_fields,
            "defaulted_fields": resolution.defaulted_fields,
            "invalid_fields": resolution.invalid_fields,
            "instrument_hint": resolution.instrument_hint,
        }
        item.validation_state = (
            QueueValidationState.valid.value
            if resolution.execution_ready
            else QueueValidationState.blocked.value
        )
        item.block_reason_code = resolution.reason_code
        item.block_reason_message = resolution.reason_message
        if not resolution.execution_ready:
            item.status = QueueStatus.blocked.value
            db.commit()
            db.refresh(item)
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="ingestion_queue",
                message=_queue_message("blocked", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={
                    "queue_id": item.id,
                    "reason_code": item.block_reason_code,
                    "unresolved_fields": resolution.unresolved_fields,
                },
            )
            return item

        try:
            intent = ExecutionIntent.model_validate(item.execution_intent_json)
        except Exception as exc:  # noqa: BLE001
            item.status = QueueStatus.blocked.value
            item.validation_state = QueueValidationState.blocked.value
            item.block_reason_code = "INTENT_INVALID"
            item.block_reason_message = "Execution intent is invalid"
            db.commit()
            db.refresh(item)
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="ingestion_queue",
                message=_queue_message("blocked", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={"queue_id": item.id, "error": str(exc)},
            )
            return item

        validation = validate_execution_intent(intent)
        item.validation_state = validation.state.value
        item.block_reason_code = validation.reason_code
        item.block_reason_message = validation.reason_message
        if validation.state == QueueValidationState.blocked:
            item.status = QueueStatus.blocked.value
            db.commit()
            db.refresh(item)
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="ingestion_queue",
                message=_queue_message("blocked", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={"queue_id": item.id, "reason_code": item.block_reason_code},
            )
            return item

        gate = dispatch_gating_service.evaluate(
            db,
            user=user,
            broker=intent.entry.broker,
            correlation_id=item.correlation_id,
        )
        if not gate.allowed:
            item.status = QueueStatus.blocked.value
            item.validation_state = QueueValidationState.blocked.value
            item.block_reason_code = gate.reason_code
            item.block_reason_message = gate.reason_message
            db.commit()
            db.refresh(item)
            system_events_service.emit(
                db,
                level=SystemEventLevel.WARNING,
                category="ingestion_queue",
                message=_queue_message("blocked", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={
                    "queue_id": item.id,
                    "reason_code": item.block_reason_code,
                    "diagnostics": gate.diagnostics,
                },
            )
            return item

        item.status = QueueStatus.approved.value
        db.commit()
        db.refresh(item)
        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO,
            category="ingestion_queue",
            message=_queue_message("executing", item=item),
            correlation_id=item.correlation_id,
            user_id=user.id,
            broker=item.broker_key,
            symbol=None,
            metadata={"queue_id": item.id, **_intent_summary(intent)},
        )

        instrument = instrument_registry_service.get_by_canonical_id(
            db, intent.entry.canonical_id
        )
        if not instrument:
            item.status = QueueStatus.failed.value
            item.block_reason_code = "INSTRUMENT_MISSING"
            item.block_reason_message = "Instrument not found"
            db.commit()
            db.refresh(item)
            return item

        dispatch_tags = {
            "queue_id": str(item.id),
            "source_type": item.source_type,
        }
        order_source = _order_source_for_queue_item(item)

        try:
            if instrument.exchange in {"NSE_EQ", "BSE_EQ"}:
                preview = order_service.preview_stock_order(
                    db,
                    user=user,
                    broker=intent.entry.broker,
                    canonical_id=instrument.canonical_id,
                    side=intent.entry.side,
                    quantity=intent.entry.quantity,
                    product=intent.entry.product,
                    order_type=intent.entry.order_type,
                    limit_price=intent.entry.limit_price,
                    source=order_source,
                    execution_intent_json=intent.model_dump(mode="json"),
                )
                order, result, _ = order_service.place_stock_order(
                    db,
                    user=user,
                    preview=preview,
                    correlation_id=item.correlation_id,
                    dispatch_tags=dispatch_tags,
                )
            else:
                inst_type = InstrumentType(instrument.instrument_type)
                opt_type = (
                    OptionType(instrument.option_type)
                    if instrument.option_type
                    else None
                )
                lots = (
                    intent.entry.lots
                    if intent.entry.lots is not None
                    else max(
                        1,
                        int(intent.entry.quantity) // int(instrument.lot_size or 1),
                    )
                )
                preview = order_service.preview_fno_order(
                    db,
                    user=user,
                    broker=intent.entry.broker,
                    canonical_id=instrument.canonical_id,
                    instrument_type=inst_type,
                    underlying=instrument.underlying or instrument.symbol_root,
                    expiry=instrument.expiry,
                    strike=instrument.strike,
                    option_type=opt_type,
                    side=intent.entry.side,
                    lots=lots,
                    product=intent.entry.product,
                    order_type=intent.entry.order_type,
                    limit_price=intent.entry.limit_price,
                    source=order_source,
                    execution_intent_json=intent.model_dump(mode="json"),
                )
                order, result, _ = order_service.place_fno_order(
                    db,
                    user=user,
                    preview=preview,
                    correlation_id=item.correlation_id,
                    dispatch_tags=dispatch_tags,
                )
        except (OrderValidationError, OrderDependencyError) as exc:
            item.status = QueueStatus.failed.value
            item.block_reason_code = "ORDER_CREATE_FAILED"
            item.block_reason_message = str(exc)
            db.commit()
            db.refresh(item)
            system_events_service.emit(
                db,
                level=SystemEventLevel.ERROR,
                category="ingestion_queue",
                message=_queue_message("failed", item=item),
                correlation_id=item.correlation_id,
                user_id=user.id,
                broker=item.broker_key,
                symbol=None,
                metadata={"queue_id": item.id},
            )
            return item

        item.dispatched_order_id = order.id
        if order.status == "ACKNOWLEDGED":
            item.status = QueueStatus.dispatched.value
            item.block_reason_code = None
            item.block_reason_message = None
        else:
            item.status = QueueStatus.failed.value
            item.block_reason_code = getattr(order, "failure_reason_code", None)
            item.block_reason_message = getattr(order, "failure_reason_message", None)

        db.commit()
        db.refresh(item)
        system_events_service.emit(
            db,
            level=SystemEventLevel.INFO
            if item.status == QueueStatus.dispatched.value
            else SystemEventLevel.ERROR,
            category="ingestion_queue",
            message=_queue_message(
                "dispatched"
                if item.status == QueueStatus.dispatched.value
                else "failed",
                item=item,
            ),
            correlation_id=item.correlation_id,
            user_id=user.id,
            broker=item.broker_key,
            symbol=None,
            metadata={
                "queue_id": item.id,
                "order_id": order.id,
                "order_status": order.status,
            },
        )
        return item


ingestion_queue_service = IngestionQueueService()
