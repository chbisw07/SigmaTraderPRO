from __future__ import annotations

from sqlalchemy.orm import Session

from app.brokers.base import BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey
from app.models.instrument import Instrument
from app.models.instrument_mapping import InstrumentMapping
from app.models.order import Order
from app.models.position import Position
from app.models.user import User
from app.orders.types import ExternalBrokerPosition, OrderSide
from app.services.broker_service import broker_service


class PositionService:
    """
    Minimal broker-neutral position ledger (S4.2.1).

    This is intentionally simple and is updated from locally-submitted orders.
    Live broker reconciliation / fill-based accuracy is deferred to later milestones.
    """

    def apply_order(self, db: Session, *, user: User, order: Order) -> Position | None:
        # Only apply for orders that represent a submitted intent.
        if not order.canonical_id or not order.broker_key:
            return None

        delta_qty = (
            int(order.quantity)
            if order.side == OrderSide.BUY.value
            else -int(order.quantity)
        )
        delta_lots = None
        if order.lots is not None:
            delta_lots = (
                int(order.lots)
                if order.side == OrderSide.BUY.value
                else -int(order.lots)
            )

        pos = (
            db.query(Position)
            .filter(Position.user_id == user.id)
            .filter(Position.broker_key == order.broker_key)
            .filter(Position.canonical_id == order.canonical_id)
            .one_or_none()
        )

        if not pos:
            if delta_qty == 0:
                return None
            side = OrderSide.BUY.value if delta_qty > 0 else OrderSide.SELL.value
            pos = Position(
                user_id=user.id,
                broker_key=order.broker_key,
                canonical_id=order.canonical_id,
                side=side,
                quantity=abs(delta_qty),
                lots=abs(delta_lots) if delta_lots is not None else None,
                avg_price=(
                    float(order.limit_price) if order.limit_price is not None else None
                ),
                last_price=None,
                realized_pnl=None,
                unrealized_pnl=None,
                mtm=None,
                broker_position_id=None,
                source=order.source,
            )
            db.add(pos)
            db.flush()
            return pos

        # Existing net position.
        existing_sign = 1 if pos.side == OrderSide.BUY.value else -1
        net_qty = existing_sign * int(pos.quantity) + delta_qty
        net_lots = None
        if pos.lots is not None or delta_lots is not None:
            net_lots = existing_sign * int(pos.lots or 0) + int(delta_lots or 0)

        if net_qty == 0:
            db.delete(pos)
            db.flush()
            return None

        next_side = OrderSide.BUY.value if net_qty > 0 else OrderSide.SELL.value
        next_qty = abs(net_qty)
        next_lots = abs(net_lots) if net_lots is not None else None

        # Avg price update: only when adding in the same direction and we have prices.
        if (
            order.limit_price is not None
            and pos.avg_price is not None
            and next_side == pos.side
            and delta_qty != 0
            and (existing_sign * delta_qty) > 0
        ):
            prev_qty = int(pos.quantity)
            add_qty = abs(delta_qty)
            pos.avg_price = (
                (float(pos.avg_price) * prev_qty) + (float(order.limit_price) * add_qty)
            ) / (prev_qty + add_qty)
        elif (
            pos.avg_price is None
            and order.limit_price is not None
            and next_side == pos.side
            and (existing_sign * delta_qty) > 0
        ):
            pos.avg_price = float(order.limit_price)

        pos.side = next_side
        pos.quantity = next_qty
        pos.lots = next_lots
        pos.source = order.source
        db.flush()
        return pos

    def _resolve_instrument(
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

    def sync_from_broker_positionbook(
        self,
        db: Session,
        *,
        user: User,
        broker: BrokerKey,
    ) -> tuple[int, int, int, set[str], str | None]:
        """
        Pull broker positionbook and update the local positions ledger.

        This is intentionally bounded:
        - Uses broker as the truth for net positions.
        - Updates/creates local rows for resolved canonical instruments.
        - For local rows that are not present in the broker snapshot, marks them
          closed by setting quantity/lots to 0 (so they no longer render).
        - Does not attempt fill-level reconciliation.
        """
        adapter = broker_service.get_adapter(broker)
        try:
            external_positions = adapter.fetch_positions(db, user)
        except (BrokerNotConfiguredError, BrokerError) as exc:
            return 0, 0, str(exc)
        except Exception:  # noqa: BLE001
            return 0, 0, f"{broker.value} positionbook fetch failed"

        upserted = 0
        closed = 0
        skipped_unmapped = 0
        unmapped_tokens: set[str] = set()

        seen_canonical_ids: set[str] = set()

        def _upsert(inst: Instrument, row: ExternalBrokerPosition) -> None:
            nonlocal upserted
            if row.net_quantity == 0:
                return

            side = OrderSide.BUY.value if row.net_quantity > 0 else OrderSide.SELL.value
            qty = abs(int(row.net_quantity))
            lots = None
            if inst.lot_size and inst.lot_size > 1 and qty % int(inst.lot_size) == 0:
                lots = int(qty // int(inst.lot_size))

            pos = (
                db.query(Position)
                .filter(Position.user_id == user.id)
                .filter(Position.broker_key == broker.value)
                .filter(Position.canonical_id == inst.canonical_id)
                .one_or_none()
            )
            if not pos:
                pos = Position(
                    user_id=user.id,
                    broker_key=broker.value,
                    canonical_id=inst.canonical_id,
                    side=side,
                    quantity=qty,
                    lots=lots,
                    avg_price=row.avg_price,
                    last_price=row.last_price,
                    realized_pnl=row.realized_pnl,
                    unrealized_pnl=row.unrealized_pnl,
                    mtm=row.mtm,
                    broker_position_id=row.broker_position_id,
                    source="manual_ui",
                )
                db.add(pos)
                upserted += 1
                return

            pos.side = side
            pos.quantity = qty
            pos.lots = lots
            pos.avg_price = row.avg_price
            pos.last_price = row.last_price
            pos.realized_pnl = row.realized_pnl
            pos.unrealized_pnl = row.unrealized_pnl
            pos.mtm = row.mtm
            pos.broker_position_id = row.broker_position_id
            db.add(pos)
            upserted += 1

        for row in external_positions:
            inst = self._resolve_instrument(
                db,
                broker=broker,
                broker_instrument_id=row.broker_instrument_id,
                trading_symbol=row.trading_symbol,
            )
            if not inst:
                skipped_unmapped += 1
                if row.broker_instrument_id:
                    unmapped_tokens.add(str(row.broker_instrument_id))
                continue
            seen_canonical_ids.add(inst.canonical_id)
            _upsert(inst, row)

        # Mark local positions closed if broker snapshot does not contain them.
        # We keep rows (FK-safe) but set qty/lots to 0 so list endpoint can hide them.
        existing = (
            db.query(Position)
            .filter(Position.user_id == user.id)
            .filter(Position.broker_key == broker.value)
            .filter(Position.quantity > 0)
            .all()
        )
        for pos in existing:
            if pos.canonical_id not in seen_canonical_ids:
                pos.quantity = 0
                pos.lots = 0 if pos.lots is not None else None
                pos.last_price = None
                pos.unrealized_pnl = None
                pos.mtm = None
                db.add(pos)
                closed += 1

        if upserted or closed:
            db.commit()
        return upserted, closed, skipped_unmapped, unmapped_tokens, None


position_service = PositionService()
