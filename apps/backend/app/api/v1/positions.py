from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.position import Position
from app.models.user import User
from app.orders.types import (
    OrderIntentType,
    OrderProduct,
    OrderSide,
    OrderSource,
    OrderTriggerMode,
    OrderType,
)
from app.schemas.instrument import InstrumentOut
from app.schemas.order import OrderDraft, OrderDraftResponse, OrderIntentMetadata
from app.schemas.position import PositionListResponse, PositionOut
from app.services.position_service import position_service

router = APIRouter(prefix="/positions", tags=["positions"])


def _position_out(
    pos: Position, inst: Instrument | None, linked_orders_count: int
) -> PositionOut:
    inst_out = (
        InstrumentOut.model_validate(inst, from_attributes=True) if inst else None
    )
    return PositionOut(
        id=pos.id,
        opened_at=pos.opened_at,
        updated_at=pos.updated_at,
        broker=pos.broker_key,  # type: ignore[arg-type]
        canonical_id=pos.canonical_id,
        instrument=inst_out,
        side=pos.side,  # type: ignore[arg-type]
        quantity=pos.quantity,
        lots=pos.lots,
        avg_price=float(pos.avg_price) if pos.avg_price is not None else None,
        last_price=float(pos.last_price) if pos.last_price is not None else None,
        realized_pnl=float(pos.realized_pnl) if pos.realized_pnl is not None else None,
        unrealized_pnl=float(pos.unrealized_pnl)
        if pos.unrealized_pnl is not None
        else None,
        mtm=float(pos.mtm) if pos.mtm is not None else None,
        linked_orders_count=linked_orders_count,
        source=OrderSource(pos.source),
    )


@router.get("", response_model=PositionListResponse)
def list_positions(
    broker: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PositionListResponse:
    count_subq = (
        db.query(Order.linked_position_id, func.count(Order.id).label("cnt"))
        .filter(Order.user_id == current_user.id)
        .group_by(Order.linked_position_id)
        .subquery()
    )

    qry = (
        db.query(Position, Instrument, func.coalesce(count_subq.c.cnt, 0))
        .outerjoin(Instrument, Instrument.canonical_id == Position.canonical_id)
        .outerjoin(count_subq, count_subq.c.linked_position_id == Position.id)
        .filter(Position.user_id == current_user.id)
        .filter(Position.quantity > 0)
    )
    if broker:
        qry = qry.filter(Position.broker_key == broker)
    if q:
        like = f"%{q.strip().upper()}%"
        qry = qry.filter(
            (Position.canonical_id.ilike(like))
            | (Instrument.display_symbol.ilike(like))
            | (Instrument.symbol_root.ilike(like))
            | (Instrument.underlying.ilike(like))
        )

    rows = qry.order_by(Position.updated_at.desc()).limit(limit).all()
    items: list[PositionOut] = []
    for pos, inst, cnt in rows:
        items.append(_position_out(pos, inst, int(cnt or 0)))
    return PositionListResponse(items=items)


def _draft_for_position(
    *,
    inst: Instrument,
    pos: Position,
    side: OrderSide,
    multiplier: int,
    intent_type: OrderIntentType,
) -> OrderDraft:
    # Minimal defaults; user can adjust in ticket before preview/placement.
    is_cash = inst.segment == "EQUITY" and inst.instrument_type in {"EQUITY", "ETF"}

    qty = pos.quantity * multiplier
    lots = (pos.lots * multiplier) if pos.lots is not None else None

    # Prefer MARKET for speed; UI/validation will block where broker constraints apply.
    order_type = OrderType.MARKET
    product = (
        OrderProduct.CNC if is_cash else OrderProduct.NRML  # sensible default
    )

    return OrderDraft(
        instrument=InstrumentOut.model_validate(inst, from_attributes=True),
        broker=pos.broker_key,  # type: ignore[arg-type]
        side=side,
        quantity=qty if is_cash else None,
        lots=lots,
        product=product,
        order_type=order_type,
        limit_price=None,
        reference_price=None,
        intent=OrderIntentMetadata(
            source=OrderSource.manual_ui,
            intent_type=intent_type,
            trigger_mode=OrderTriggerMode.MARKET,
            parent_order_id=None,
            linked_position_id=pos.id,
            broker_context=pos.broker_key,
        ),
    )


@router.post("/{position_id}/squareoff", response_model=OrderDraftResponse)
def squareoff_draft(
    position_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderDraftResponse:
    row = (
        db.query(Position, Instrument)
        .outerjoin(Instrument, Instrument.canonical_id == Position.canonical_id)
        .filter(Position.user_id == current_user.id)
        .filter(Position.id == position_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Position not found")
    pos, inst = row
    if not inst:
        raise HTTPException(status_code=400, detail="Instrument not found for position")

    next_side = OrderSide.SELL if pos.side == OrderSide.BUY.value else OrderSide.BUY
    draft = _draft_for_position(
        inst=inst,
        pos=pos,
        side=next_side,
        multiplier=1,
        intent_type=OrderIntentType.EXIT,
    )
    return OrderDraftResponse(draft=draft)


@router.post("/{position_id}/reverse", response_model=OrderDraftResponse)
def reverse_draft(
    position_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderDraftResponse:
    row = (
        db.query(Position, Instrument)
        .outerjoin(Instrument, Instrument.canonical_id == Position.canonical_id)
        .filter(Position.user_id == current_user.id)
        .filter(Position.id == position_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Position not found")
    pos, inst = row
    if not inst:
        raise HTTPException(status_code=400, detail="Instrument not found for position")

    next_side = OrderSide.SELL if pos.side == OrderSide.BUY.value else OrderSide.BUY
    # Reverse = close current and open opposite same size => 2x in opposite direction.
    draft = _draft_for_position(
        inst=inst,
        pos=pos,
        side=next_side,
        multiplier=2,
        intent_type=OrderIntentType.EXIT,
    )
    return OrderDraftResponse(draft=draft)


@router.post("/{position_id}/refresh")
def refresh_position(
    position_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    pos = (
        db.query(Position)
        .filter(Position.user_id == current_user.id)
        .filter(Position.id == position_id)
        .one_or_none()
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")

    from app.brokers.types import BrokerKey  # local import to avoid cycles

    try:
        broker = BrokerKey(pos.broker_key)
    except Exception:
        raise HTTPException(status_code=400, detail="Unknown broker") from None

    upserted, closed, err = position_service.sync_from_broker_positionbook(
        db, user=current_user, broker=broker
    )
    if err:
        return {"status": "ok", "message": f"Broker sync warning: {err}"}
    return {
        "status": "ok",
        "message": f"Synced {upserted} positions, closed {closed}",
    }
