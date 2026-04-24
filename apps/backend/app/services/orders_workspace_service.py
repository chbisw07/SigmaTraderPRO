from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.brokers.base import BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.order import Order
from app.models.user import User
from app.orders.types import (
    OrderIntentType,
    OrderProduct,
    OrderSide,
    OrderSource,
    OrderStatus,
    OrderType,
)
from app.schemas.instrument import InstrumentOut
from app.schemas.orders_workspace import (
    OrdersReconciliationState,
    OrdersSourceMode,
    OrdersSourceOrigin,
    OrdersWorkspaceMeta,
    OrdersWorkspaceResponse,
    OrdersWorkspaceRow,
)
from app.services.broker_service import broker_service


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _coerce_status(value: str | None) -> OrderStatus | None:
    if not value:
        return None
    raw = str(value).strip().upper()

    # Broker-specific normalizations (best-effort, conservative).
    if raw in {"COMPLETE", "COMPLETED", "EXECUTED", "TRADED"}:
        return OrderStatus.EXECUTED
    if raw in {"CANCELLED", "CANCELED"}:
        return OrderStatus.CANCELLED
    if raw in {"REJECTED", "REJECT", "FAILED", "ERROR"}:
        return OrderStatus.REJECTED
    if raw in {"OPEN", "TRIGGER PENDING", "TRIGGER_PENDING"}:
        return OrderStatus.OPEN
    if raw in {"PENDING", "PUT ORDER REQ RECEIVED", "ORDER RECEIVED"}:
        return OrderStatus.PENDING
    if raw in {"PARTIAL"}:
        return OrderStatus.PARTIAL

    # Try direct match to internal enum.
    for s in OrderStatus:
        if s.value == raw:
            return s
    return None


def _coerce_side(value: str | None) -> OrderSide | None:
    if not value:
        return None
    raw = str(value).strip().upper()
    if raw in {"BUY", "B"}:
        return OrderSide.BUY
    if raw in {"SELL", "S"}:
        return OrderSide.SELL
    return None


def _coerce_product(value: str | None) -> OrderProduct | None:
    if not value:
        return None
    raw = str(value).strip().upper()
    if raw in {"CNC", "DELIVERY", "NRML", "MIS", "INTRADAY", "CARRYFORWARD"}:
        if raw in {"DELIVERY"}:
            return OrderProduct.CNC
        if raw in {"INTRADAY"}:
            return OrderProduct.MIS
        if raw in {"CARRYFORWARD"}:
            return OrderProduct.NRML
        return OrderProduct(raw)
    return None


def _coerce_order_type(value: str | None) -> OrderType | None:
    if not value:
        return None
    raw = str(value).strip().upper()
    if raw in {"MARKET", "MKT"}:
        return OrderType.MARKET
    if raw in {"LIMIT", "LMT"}:
        return OrderType.LIMIT
    return None


@dataclass(frozen=True, slots=True)
class _InternalRow:
    order: Order
    instrument: Instrument | None


@dataclass(frozen=True, slots=True)
class _ExternalRow:
    broker: BrokerKey
    broker_order_id: str | None
    exchange_order_id: str | None
    canonical_id: str | None
    instrument: Instrument | None
    symbol_display: str | None
    side: OrderSide | None
    product: OrderProduct | None
    order_type: OrderType | None
    quantity: int | None
    lots: int | None
    placed_price: float | None
    avg_price: float | None
    status: OrderStatus | None
    rejection_reason: str | None
    placed_at: datetime | None


class OrdersWorkspaceService:
    def _row_needs_reconciliation(
        self, *, internal: Order, external: _ExternalRow
    ) -> bool:
        """
        Detect when internal persisted state diverges from broker truth.

        This does not mutate internal state; it only marks rows so the operator can
        run an explicit reconcile.
        """
        internal_status = _coerce_status(internal.status)
        if internal_status and external.status and internal_status != external.status:
            return True

        try:
            internal_avg = (
                float(internal.avg_executed_price)
                if internal.avg_executed_price is not None
                else None
            )
        except Exception:
            internal_avg = None

        try:
            external_avg = (
                float(external.avg_price) if external.avg_price is not None else None
            )
        except Exception:
            external_avg = None

        if (
            internal_avg is not None
            and external_avg is not None
            and abs(internal_avg - external_avg) > 0.01
        ):
            return True

        return bool(
            external.rejection_reason
            and (internal.error_message != external.rejection_reason)
        )

    def _query_internal(
        self,
        db: Session,
        *,
        user: User,
        broker: str | None,
        status_filter: str | None,
        product_filter: str | None,
        instrument_type: str | None,
        q: str | None,
        limit: int,
    ) -> list[_InternalRow]:
        qry = (
            db.query(Order, Instrument)
            .outerjoin(Instrument, Instrument.canonical_id == Order.canonical_id)
            .filter(Order.user_id == user.id)
        )
        if broker:
            qry = qry.filter(Order.broker_key == broker)
        if status_filter:
            qry = qry.filter(Order.status.ilike(status_filter))
        if product_filter:
            qry = qry.filter(Order.product.ilike(product_filter))
        if instrument_type:
            qry = qry.filter(Instrument.instrument_type == instrument_type)
        if q:
            like = f"%{q.strip().upper()}%"
            qry = qry.filter(
                (Order.canonical_id.ilike(like))
                | (Order.broker_order_id.ilike(like))
                | (Order.correlation_id.ilike(like))
                | (Order.blocked_reason_message.ilike(like))
                | (Order.failure_reason_message.ilike(like))
                | (Order.error_message.ilike(like))
                | (Instrument.display_symbol.ilike(like))
                | (Instrument.symbol_root.ilike(like))
                | (Instrument.underlying.ilike(like))
            )

        rows = qry.order_by(Order.created_at.desc()).limit(limit).all()
        out: list[_InternalRow] = []
        for o, inst in rows:
            out.append(_InternalRow(order=o, instrument=inst))
        return out

    def _resolve_instrument_for_external(
        self,
        db: Session,
        *,
        broker: BrokerKey,
        broker_instrument_id: str | None,
        trading_symbol: str | None,
    ) -> Instrument | None:
        qry = (
            db.query(Instrument)
            .join(InstrumentMapping, InstrumentMapping.instrument_id == Instrument.id)
            .filter(InstrumentMapping.is_active.is_(True))
            .filter(InstrumentMapping.broker_key == broker.value)
        )
        if broker_instrument_id:
            inst = qry.filter(
                InstrumentMapping.broker_instrument_id == broker_instrument_id
            ).one_or_none()
            if inst:
                return inst

        if trading_symbol:
            return qry.filter(
                InstrumentMapping.broker_trading_symbol == trading_symbol
            ).one_or_none()
        return None

    def _fetch_external(
        self, db: Session, *, user: User, broker: BrokerKey
    ) -> tuple[list[_ExternalRow], str | None]:
        adapter = broker_service.get_adapter(broker)
        try:
            rows = adapter.fetch_recent_orders(db, user)
        except (BrokerNotConfiguredError, BrokerError) as exc:
            # Non-blocking: we surface a short error string and return empty list.
            return [], str(exc)
        except Exception:  # noqa: BLE001
            return [], f"{broker.value} orderbook fetch failed"

        out: list[_ExternalRow] = []
        for r in rows:
            broker_order_id = r.broker_order_id
            exchange_order_id = r.exchange_order_id
            inst = self._resolve_instrument_for_external(
                db,
                broker=broker,
                broker_instrument_id=r.broker_instrument_id,
                trading_symbol=r.trading_symbol,
            )
            canonical_id = inst.canonical_id if inst else None
            symbol_display = None
            if inst:
                symbol_display = inst.display_symbol
            elif r.trading_symbol:
                symbol_display = str(r.trading_symbol)

            placed_at = r.placed_at
            if placed_at and placed_at.tzinfo is None:
                placed_at = placed_at.replace(tzinfo=UTC)

            out.append(
                _ExternalRow(
                    broker=broker,
                    broker_order_id=broker_order_id,
                    exchange_order_id=exchange_order_id,
                    canonical_id=canonical_id,
                    instrument=inst,
                    symbol_display=symbol_display,
                    side=_coerce_side(r.side),
                    product=_coerce_product(r.product),
                    order_type=_coerce_order_type(r.order_type),
                    quantity=r.quantity,
                    lots=None,
                    placed_price=r.price,
                    avg_price=r.avg_price,
                    status=_coerce_status(r.status),
                    rejection_reason=r.rejection_reason,
                    placed_at=placed_at,
                )
            )
        return out, None

    def list_workspace(
        self,
        db: Session,
        *,
        user: User,
        include_broker_orders: bool,
        mode: OrdersSourceMode,
        broker: str | None = None,
        status_filter: str | None = None,
        product_filter: str | None = None,
        instrument_type: str | None = None,
        q: str | None = None,
        limit: int = 200,
    ) -> OrdersWorkspaceResponse:
        # Effective mode enforcement.
        effective_include = bool(include_broker_orders)
        effective_mode = mode
        if not effective_include and mode != OrdersSourceMode.internal_only:
            effective_mode = OrdersSourceMode.internal_only

        internal_rows = (
            []
            if effective_mode == OrdersSourceMode.broker_only
            else self._query_internal(
                db,
                user=user,
                broker=broker,
                status_filter=status_filter,
                product_filter=product_filter,
                instrument_type=instrument_type,
                q=q,
                limit=limit,
            )
        )

        broker_errors: dict[str, str] = {}
        external_rows: list[_ExternalRow] = []
        if effective_include and effective_mode != OrdersSourceMode.internal_only:
            brokers = [BrokerKey.angel, BrokerKey.zerodha]
            if broker in {BrokerKey.angel.value, BrokerKey.zerodha.value}:
                brokers = [BrokerKey(broker)]
            for b in brokers:
                fetched, err = self._fetch_external(db, user=user, broker=b)
                if err:
                    broker_errors[b.value] = err
                external_rows.extend(fetched)

        # Internal index for matching.
        internal_by_broker_id: dict[tuple[str, str], _InternalRow] = {}
        internal_by_exchange_id: dict[tuple[str, str], _InternalRow] = {}
        for ir in internal_rows:
            if ir.order.broker_key and ir.order.broker_order_id:
                key = (ir.order.broker_key, ir.order.broker_order_id)
                internal_by_broker_id[key] = ir
            exch_id = None
            snap = ir.order.preview_snapshot_json or {}
            if isinstance(snap, dict):
                exch_id = snap.get("exchange_order_id")
            if exch_id:
                internal_by_exchange_id[(ir.order.broker_key, str(exch_id))] = ir

        matched_internal_ids: set[int] = set()
        items: list[OrdersWorkspaceRow] = []

        def _inst_out(inst: Instrument | None) -> InstrumentOut | None:
            return (
                InstrumentOut.model_validate(inst, from_attributes=True)
                if inst
                else None
            )

        # External first to allow merged status to prefer broker truth.
        for er in external_rows:
            match: _InternalRow | None = None
            if er.broker_order_id:
                match = internal_by_broker_id.get((er.broker.value, er.broker_order_id))
            if not match and er.exchange_order_id:
                match = internal_by_exchange_id.get(
                    (er.broker.value, er.exchange_order_id)
                )

            if match:
                matched_internal_ids.add(match.order.id)
                inst = match.instrument or er.instrument
                placed_at = er.placed_at or match.order.created_at
                if isinstance(placed_at, datetime) and placed_at.tzinfo is None:
                    placed_at = placed_at.replace(tzinfo=UTC)
                recon_state = (
                    OrdersReconciliationState.unresolved
                    if self._row_needs_reconciliation(internal=match.order, external=er)
                    else OrdersReconciliationState.matched
                )
                items.append(
                    OrdersWorkspaceRow(
                        row_id=(
                            f"m:{match.order.id}:{er.broker.value}:"
                            f"{er.broker_order_id or 'na'}"
                        ),
                        source_origin=OrdersSourceOrigin.merged,
                        reconciliation_state=recon_state,
                        broker=er.broker,
                        internal_order_id=match.order.id,
                        broker_order_id=(
                            er.broker_order_id or match.order.broker_order_id
                        ),
                        exchange_order_id=er.exchange_order_id,
                        canonical_id=match.order.canonical_id,
                        instrument=_inst_out(inst),
                        symbol_display=(
                            inst.display_symbol if inst else er.symbol_display
                        ),
                        side=er.side or _coerce_side(match.order.side),
                        product=er.product or _coerce_product(match.order.product),
                        quantity=er.quantity or int(match.order.quantity),
                        lots=match.order.lots,
                        order_type=er.order_type
                        or _coerce_order_type(match.order.order_type),
                        placed_price=er.placed_price
                        or (
                            float(match.order.limit_price)
                            if match.order.limit_price is not None
                            else None
                        ),
                        avg_price=er.avg_price
                        or (
                            float(match.order.avg_executed_price)
                            if match.order.avg_executed_price is not None
                            else None
                        ),
                        status=er.status or _coerce_status(match.order.status),
                        rejection_reason=(
                            er.rejection_reason or match.order.error_message
                        ),
                        correlation_id=getattr(match.order, "correlation_id", None),
                        blocked_reason_code=getattr(
                            match.order, "blocked_reason_code", None
                        ),
                        blocked_reason_message=getattr(
                            match.order, "blocked_reason_message", None
                        ),
                        failure_reason_code=getattr(
                            match.order, "failure_reason_code", None
                        ),
                        failure_reason_message=getattr(
                            match.order, "failure_reason_message", None
                        ),
                        placed_at=placed_at,
                        source=(
                            OrderSource(match.order.source)
                            if match.order.source
                            else None
                        ),
                        intent_type=(
                            OrderIntentType(match.order.intent_type)
                            if match.order.intent_type
                            else None
                        ),
                        linked_position_id=match.order.linked_position_id,
                    )
                )
            else:
                if effective_mode != OrdersSourceMode.internal_only:
                    placed_at = er.placed_at
                    items.append(
                        OrdersWorkspaceRow(
                            row_id=(
                                f"b:{er.broker.value}:"
                                f"{er.broker_order_id or er.exchange_order_id or 'na'}"
                            ),
                            source_origin=OrdersSourceOrigin.broker_external,
                            reconciliation_state=OrdersReconciliationState.broker_only,
                            broker=er.broker,
                            internal_order_id=None,
                            broker_order_id=er.broker_order_id,
                            exchange_order_id=er.exchange_order_id,
                            canonical_id=er.canonical_id,
                            instrument=_inst_out(er.instrument),
                            symbol_display=er.symbol_display,
                            side=er.side,
                            product=er.product,
                            quantity=er.quantity,
                            lots=er.lots,
                            order_type=er.order_type,
                            placed_price=er.placed_price,
                            avg_price=er.avg_price,
                            status=er.status,
                            rejection_reason=er.rejection_reason,
                            correlation_id=None,
                            blocked_reason_code=None,
                            blocked_reason_message=None,
                            failure_reason_code=None,
                            failure_reason_message=None,
                            placed_at=placed_at,
                            source=None,
                            intent_type=None,
                            linked_position_id=None,
                        )
                    )

        # Internal-only rows.
        if effective_mode != OrdersSourceMode.broker_only:
            for ir in internal_rows:
                if ir.order.id in matched_internal_ids:
                    continue
                inst = ir.instrument
                placed_at = ir.order.created_at
                if isinstance(placed_at, datetime) and placed_at.tzinfo is None:
                    placed_at = placed_at.replace(tzinfo=UTC)
                items.append(
                    OrdersWorkspaceRow(
                        row_id=f"i:{ir.order.id}",
                        source_origin=OrdersSourceOrigin.sigmatrader,
                        reconciliation_state=OrdersReconciliationState.internal_only,
                        broker=BrokerKey(ir.order.broker_key),
                        internal_order_id=ir.order.id,
                        broker_order_id=ir.order.broker_order_id,
                        exchange_order_id=None,
                        canonical_id=ir.order.canonical_id,
                        instrument=_inst_out(inst),
                        symbol_display=inst.display_symbol if inst else None,
                        side=_coerce_side(ir.order.side),
                        product=_coerce_product(ir.order.product),
                        quantity=int(ir.order.quantity),
                        lots=ir.order.lots,
                        order_type=_coerce_order_type(ir.order.order_type),
                        placed_price=(
                            float(ir.order.limit_price)
                            if ir.order.limit_price is not None
                            else None
                        ),
                        avg_price=(
                            float(ir.order.avg_executed_price)
                            if ir.order.avg_executed_price is not None
                            else None
                        ),
                        status=_coerce_status(ir.order.status),
                        rejection_reason=ir.order.error_message,
                        correlation_id=getattr(ir.order, "correlation_id", None),
                        blocked_reason_code=getattr(
                            ir.order, "blocked_reason_code", None
                        ),
                        blocked_reason_message=getattr(
                            ir.order, "blocked_reason_message", None
                        ),
                        failure_reason_code=getattr(
                            ir.order, "failure_reason_code", None
                        ),
                        failure_reason_message=getattr(
                            ir.order, "failure_reason_message", None
                        ),
                        placed_at=placed_at,
                        source=(
                            OrderSource(ir.order.source) if ir.order.source else None
                        ),
                        intent_type=(
                            OrderIntentType(ir.order.intent_type)
                            if ir.order.intent_type
                            else None
                        ),
                        linked_position_id=ir.order.linked_position_id,
                    )
                )

        # Mode filtering post-merge, for safety.
        if effective_mode == OrdersSourceMode.internal_only:
            items = [
                i
                for i in items
                if i.source_origin != OrdersSourceOrigin.broker_external
            ]
        elif effective_mode == OrdersSourceMode.broker_only:
            items = [
                i for i in items if i.source_origin != OrdersSourceOrigin.sigmatrader
            ]

        if q:
            needle = q.strip().upper()

            def _hit(row: OrdersWorkspaceRow) -> bool:
                if not needle:
                    return True
                for value in [
                    row.canonical_id,
                    row.symbol_display,
                    row.broker_order_id,
                    row.exchange_order_id,
                    row.correlation_id,
                    row.rejection_reason,
                    row.blocked_reason_message,
                    row.failure_reason_message,
                ]:
                    if value and needle in str(value).upper():
                        return True
                return False

            items = [i for i in items if _hit(i)]

        if broker:
            want = broker.strip().lower()
            items = [i for i in items if i.broker.value == want]

        if status_filter:
            want = status_filter.strip().upper()
            items = [i for i in items if (i.status and i.status.value == want)]

        if product_filter:
            want = product_filter.strip().upper()
            items = [i for i in items if (i.product and i.product.value == want)]

        if instrument_type:
            want = instrument_type.strip().upper()
            items = [
                i
                for i in items
                if (i.instrument and str(i.instrument.instrument_type).upper() == want)
            ]

        # Sort: placed_at desc, fallback now.
        items.sort(key=lambda r: r.placed_at or _now_utc(), reverse=True)
        items = items[: max(1, min(limit, 500))]

        return OrdersWorkspaceResponse(
            items=items,
            meta=OrdersWorkspaceMeta(
                include_broker_orders=effective_include,
                mode=effective_mode,
                broker_errors=broker_errors,
            ),
        )

    def reconcile_internal_orders_report(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey | None = None,
        limit: int = 500,
    ) -> tuple[int, dict[str, str], list[dict[str, str | int | None]]]:
        """
        Same reconciliation as `reconcile_internal_orders`, but returns a compact
        report of status transitions for observability.
        """
        brokers = [BrokerKey.angel, BrokerKey.zerodha]
        if broker:
            brokers = [broker]

        internal_qry = (
            db.query(Order)
            .filter(Order.user_id == user.id)
            .order_by(Order.created_at.desc())
            .limit(max(1, min(limit, 5000)))
        )
        internal_orders = list(internal_qry.all())

        internal_by_broker_id: dict[tuple[str, str], Order] = {}
        internal_by_exchange_id: dict[tuple[str, str], Order] = {}
        for o in internal_orders:
            if o.broker_key and o.broker_order_id:
                internal_by_broker_id[(o.broker_key, o.broker_order_id)] = o
            snap = o.preview_snapshot_json or {}
            if isinstance(snap, dict):
                exch = snap.get("exchange_order_id")
                if exch and o.broker_key:
                    internal_by_exchange_id[(o.broker_key, str(exch))] = o

        updated = 0
        broker_errors: dict[str, str] = {}
        transitions: list[dict[str, str | int | None]] = []

        for b in brokers:
            external_rows, err = self._fetch_external(db, user=user, broker=b)
            if err:
                broker_errors[b.value] = err
                continue

            for er in external_rows:
                match: Order | None = None
                if er.broker_order_id:
                    match = internal_by_broker_id.get((b.value, er.broker_order_id))
                if not match and er.exchange_order_id:
                    match = internal_by_exchange_id.get((b.value, er.exchange_order_id))
                if not match:
                    continue

                before_status = match.status
                changed = False

                if er.status is not None and match.status != er.status.value:
                    match.status = er.status.value
                    changed = True

                if er.avg_price is not None:
                    try:
                        next_avg = float(er.avg_price)
                    except Exception:
                        next_avg = None
                    if next_avg is not None and (
                        match.avg_executed_price is None
                        or float(match.avg_executed_price) != next_avg
                    ):
                        match.avg_executed_price = next_avg
                        changed = True

                if er.placed_price is not None and match.limit_price is None:
                    try:
                        match.limit_price = float(er.placed_price)
                        changed = True
                    except Exception:
                        pass

                if er.rejection_reason and (match.error_message != er.rejection_reason):
                    match.error_message = er.rejection_reason
                    changed = True

                if er.exchange_order_id:
                    snap = match.preview_snapshot_json or {}
                    if not isinstance(snap, dict):
                        snap = {}
                    if snap.get("exchange_order_id") != er.exchange_order_id:
                        snap["exchange_order_id"] = er.exchange_order_id
                        match.preview_snapshot_json = snap
                        changed = True

                if changed:
                    db.add(match)
                    updated += 1
                    if before_status != match.status:
                        transitions.append(
                            {
                                "order_id": match.id,
                                "broker": match.broker_key,
                                "broker_order_id": match.broker_order_id,
                                "canonical_id": match.canonical_id,
                                "correlation_id": getattr(
                                    match, "correlation_id", None
                                ),
                                "from_status": before_status,
                                "to_status": match.status,
                            }
                        )

        if updated:
            db.commit()
        return updated, broker_errors, transitions

    def reconcile_internal_orders(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey | None = None,
        limit: int = 500,
    ) -> tuple[int, dict[str, str]]:
        """
        Pull broker orderbook and update internal order lifecycle fields.

        This is intentionally bounded and conservative:
        - Only updates internal orders when a strong identifier match exists.
        - Does not create internal rows for broker-only orders.
        - Does not attempt conflict resolution or historical backfill.
        """
        brokers = [BrokerKey.angel, BrokerKey.zerodha]
        if broker:
            brokers = [broker]

        # Internal lookup maps (strong identifiers only).
        internal_qry = (
            db.query(Order)
            .filter(Order.user_id == user.id)
            .order_by(Order.created_at.desc())
            .limit(max(1, min(limit, 5000)))
        )
        internal_orders = list(internal_qry.all())

        internal_by_broker_id: dict[tuple[str, str], Order] = {}
        internal_by_exchange_id: dict[tuple[str, str], Order] = {}
        for o in internal_orders:
            if o.broker_key and o.broker_order_id:
                internal_by_broker_id[(o.broker_key, o.broker_order_id)] = o
            snap = o.preview_snapshot_json or {}
            if isinstance(snap, dict):
                exch = snap.get("exchange_order_id")
                if exch and o.broker_key:
                    internal_by_exchange_id[(o.broker_key, str(exch))] = o

        updated = 0
        broker_errors: dict[str, str] = {}

        for b in brokers:
            external_rows, err = self._fetch_external(db, user=user, broker=b)
            if err:
                broker_errors[b.value] = err
                continue

            for er in external_rows:
                match: Order | None = None
                if er.broker_order_id:
                    match = internal_by_broker_id.get((b.value, er.broker_order_id))
                if not match and er.exchange_order_id:
                    match = internal_by_exchange_id.get((b.value, er.exchange_order_id))
                if not match:
                    continue

                changed = False

                if er.status is not None and match.status != er.status.value:
                    match.status = er.status.value
                    changed = True

                if er.avg_price is not None:
                    try:
                        next_avg = float(er.avg_price)
                    except Exception:
                        next_avg = None
                    if next_avg is not None and (
                        match.avg_executed_price is None
                        or float(match.avg_executed_price) != next_avg
                    ):
                        match.avg_executed_price = next_avg
                        changed = True

                if er.placed_price is not None and match.limit_price is None:
                    try:
                        match.limit_price = float(er.placed_price)
                        changed = True
                    except Exception:
                        pass

                if er.rejection_reason and (match.error_message != er.rejection_reason):
                    match.error_message = er.rejection_reason
                    changed = True

                if er.exchange_order_id:
                    snap = match.preview_snapshot_json or {}
                    if not isinstance(snap, dict):
                        snap = {}
                    if snap.get("exchange_order_id") != er.exchange_order_id:
                        snap["exchange_order_id"] = er.exchange_order_id
                        match.preview_snapshot_json = snap
                        changed = True

                if changed:
                    db.add(match)
                    updated += 1

        if updated:
            db.commit()
        return updated, broker_errors


orders_workspace_service = OrdersWorkspaceService()
