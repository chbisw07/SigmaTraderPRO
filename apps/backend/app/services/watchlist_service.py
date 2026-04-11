from __future__ import annotations

from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.instrument import Instrument
from app.models.user import User
from app.models.watchlist import Watchlist, WatchlistItem


class WatchlistError(RuntimeError):
    pass


class WatchlistNotFoundError(WatchlistError):
    pass


def _symbol_key(*, canonical_id: str | None, underlying: str | None) -> str:
    if canonical_id:
        return canonical_id
    if underlying:
        return f"UNDERLYING:{underlying.strip().upper()}"
    raise WatchlistError("canonical_id or underlying is required")


class WatchlistService:
    def ensure_default_watchlist(self, db: Session, *, user: User) -> Watchlist:
        existing_default = (
            db.query(Watchlist)
            .filter(Watchlist.user_id == user.id)
            .filter(Watchlist.is_default.is_(True))
            .one_or_none()
        )
        if existing_default:
            return existing_default

        # If user has watchlists but none marked default, pick the earliest.
        first = (
            db.query(Watchlist)
            .filter(Watchlist.user_id == user.id)
            .order_by(Watchlist.created_at.asc())
            .first()
        )
        if first:
            first.is_default = True
            db.add(first)
            db.commit()
            db.refresh(first)
            return first

        # Create a default watchlist lazily.
        wl = Watchlist(user_id=user.id, name="Default", is_default=True)
        db.add(wl)
        db.commit()
        db.refresh(wl)
        return wl

    def list_watchlists(self, db: Session, *, user: User) -> list[Watchlist]:
        self.ensure_default_watchlist(db, user=user)
        return (
            db.query(Watchlist)
            .filter(Watchlist.user_id == user.id)
            .order_by(Watchlist.is_default.desc(), Watchlist.name.asc())
            .all()
        )

    def get_watchlist(self, db: Session, *, user: User, watchlist_id: int) -> Watchlist:
        wl = (
            db.query(Watchlist)
            .filter(Watchlist.user_id == user.id)
            .filter(Watchlist.id == watchlist_id)
            .one_or_none()
        )
        if not wl:
            raise WatchlistNotFoundError("Watchlist not found")
        return wl

    def create_watchlist(
        self,
        db: Session,
        *,
        user: User,
        name: str,
        make_default: bool = False,
    ) -> Watchlist:
        self.ensure_default_watchlist(db, user=user)
        wl = Watchlist(user_id=user.id, name=name.strip(), is_default=False)
        if make_default:
            wl.is_default = True
        db.add(wl)
        try:
            if make_default:
                db.query(Watchlist).filter(Watchlist.user_id == user.id).update(
                    {Watchlist.is_default: False}
                )
                wl.is_default = True
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise WatchlistError("Watchlist name already exists") from exc
        db.refresh(wl)
        return wl

    def update_watchlist(
        self,
        db: Session,
        *,
        user: User,
        watchlist_id: int,
        name: str | None = None,
        is_default: bool | None = None,
    ) -> Watchlist:
        wl = self.get_watchlist(db, user=user, watchlist_id=watchlist_id)
        if name is not None:
            wl.name = name.strip()
        if is_default is True and not wl.is_default:
            db.query(Watchlist).filter(Watchlist.user_id == user.id).update(
                {Watchlist.is_default: False}
            )
            wl.is_default = True

        db.add(wl)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise WatchlistError("Watchlist name already exists") from exc
        db.refresh(wl)
        return wl

    def delete_watchlist(self, db: Session, *, user: User, watchlist_id: int) -> None:
        wl = self.get_watchlist(db, user=user, watchlist_id=watchlist_id)

        # Delete items first (FK friendly).
        db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id).delete()
        db.delete(wl)
        db.commit()

        # Re-ensure a default exists if needed.
        self.ensure_default_watchlist(db, user=user)

    def list_items(
        self, db: Session, *, user: User, watchlist_id: int
    ) -> tuple[Watchlist, list[WatchlistItem]]:
        wl = self.get_watchlist(db, user=user, watchlist_id=watchlist_id)
        items = (
            db.query(WatchlistItem)
            .filter(WatchlistItem.watchlist_id == wl.id)
            .order_by(WatchlistItem.position.asc(), WatchlistItem.id.asc())
            .all()
        )
        return wl, items

    def add_item(
        self,
        db: Session,
        *,
        user: User,
        watchlist_id: int,
        canonical_id: str | None = None,
        underlying: str | None = None,
    ) -> WatchlistItem:
        wl = self.get_watchlist(db, user=user, watchlist_id=watchlist_id)
        key = _symbol_key(canonical_id=canonical_id, underlying=underlying)

        exists = (
            db.query(WatchlistItem)
            .filter(WatchlistItem.watchlist_id == wl.id)
            .filter(WatchlistItem.symbol_key == key)
            .one_or_none()
        )
        if exists:
            return exists

        next_pos = (
            db.query(func.coalesce(func.max(WatchlistItem.position), 0))
            .filter(WatchlistItem.watchlist_id == wl.id)
            .scalar()
        )
        position = int(next_pos or 0) + 1

        display_symbol = (
            underlying.strip().upper() if underlying else key.split(":")[-1]
        )
        snapshot: dict[str, object | None] = {
            "exchange": None,
            "segment": None,
            "instrument_type": None,
            "underlying": underlying.strip().upper() if underlying else None,
            "expiry": None,
            "strike": None,
            "option_type": None,
        }

        inst: Instrument | None = None
        if canonical_id:
            inst = (
                db.query(Instrument)
                .filter(Instrument.canonical_id == canonical_id)
                .one_or_none()
            )
            if inst:
                display_symbol = inst.display_symbol
                snapshot = {
                    "exchange": inst.exchange,
                    "segment": inst.segment,
                    "instrument_type": inst.instrument_type,
                    "underlying": inst.underlying,
                    "expiry": inst.expiry,
                    "strike": float(inst.strike) if inst.strike is not None else None,
                    "option_type": inst.option_type,
                }

        item = WatchlistItem(
            watchlist_id=wl.id,
            position=position,
            symbol_key=key,
            canonical_id=canonical_id,
            exchange=snapshot["exchange"],  # type: ignore[arg-type]
            segment=snapshot["segment"],  # type: ignore[arg-type]
            instrument_type=snapshot["instrument_type"],  # type: ignore[arg-type]
            display_symbol=str(display_symbol),
            underlying=snapshot["underlying"],  # type: ignore[arg-type]
            expiry=snapshot["expiry"],  # type: ignore[arg-type]
            strike=snapshot["strike"],  # type: ignore[arg-type]
            option_type=snapshot["option_type"],  # type: ignore[arg-type]
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    def remove_item(
        self,
        db: Session,
        *,
        user: User,
        watchlist_id: int,
        item_id: int,
    ) -> None:
        wl = self.get_watchlist(db, user=user, watchlist_id=watchlist_id)
        item = (
            db.query(WatchlistItem)
            .filter(WatchlistItem.watchlist_id == wl.id)
            .filter(WatchlistItem.id == item_id)
            .one_or_none()
        )
        if not item:
            raise WatchlistNotFoundError("Watchlist item not found")
        db.delete(item)
        db.commit()

    def reorder_items(
        self,
        db: Session,
        *,
        user: User,
        watchlist_id: int,
        item_ids: list[int],
    ) -> None:
        wl, existing = self.list_items(db, user=user, watchlist_id=watchlist_id)
        existing_ids = {i.id for i in existing}
        requested = [i for i in item_ids if i in existing_ids]
        if len(requested) != len(existing_ids):
            raise WatchlistError("item_ids must include all items for this watchlist")

        # Positions are unique per watchlist. Avoid transient uniqueness conflicts by
        # applying a temporary negative position pass first.
        pos = 1
        for item_id in requested:
            db.query(WatchlistItem).filter(
                and_(
                    WatchlistItem.watchlist_id == wl.id,
                    WatchlistItem.id == item_id,
                )
            ).update({WatchlistItem.position: -pos})
            pos += 1

        pos = 1
        for item_id in requested:
            db.query(WatchlistItem).filter(
                and_(
                    WatchlistItem.watchlist_id == wl.id,
                    WatchlistItem.id == item_id,
                )
            ).update({WatchlistItem.position: pos})
            pos += 1
        db.commit()


watchlist_service = WatchlistService()
