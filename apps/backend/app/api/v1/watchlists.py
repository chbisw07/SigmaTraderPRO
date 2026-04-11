from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.instrument import Instrument
from app.models.user import User
from app.schemas.instrument import InstrumentOut
from app.schemas.watchlist import (
    WatchlistCreateRequest,
    WatchlistItemCreateRequest,
    WatchlistItemOut,
    WatchlistItemsResponse,
    WatchlistListResponse,
    WatchlistOut,
    WatchlistReorderRequest,
    WatchlistUpdateRequest,
)
from app.services.watchlist_service import (
    WatchlistError,
    WatchlistNotFoundError,
    watchlist_service,
)

router = APIRouter(prefix="/watchlists", tags=["watchlists"])


def _watchlist_out(wl) -> WatchlistOut:
    return WatchlistOut.model_validate(wl, from_attributes=True)


def _item_out(db: Session, item) -> WatchlistItemOut:
    inst_out = None
    if item.canonical_id:
        inst = (
            db.query(Instrument)
            .filter(Instrument.canonical_id == item.canonical_id)
            .one_or_none()
        )
        if inst:
            inst_out = InstrumentOut.model_validate(inst, from_attributes=True)
    return WatchlistItemOut(
        id=item.id,
        position=item.position,
        symbol_key=item.symbol_key,
        canonical_id=item.canonical_id,
        instrument=inst_out,
        display_symbol=item.display_symbol,
        exchange=item.exchange,
        segment=item.segment,
        instrument_type=item.instrument_type,
        underlying=item.underlying,
        expiry=item.expiry,
        strike=float(item.strike) if item.strike is not None else None,
        option_type=item.option_type,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=WatchlistListResponse)
def list_watchlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistListResponse:
    items = watchlist_service.list_watchlists(db, user=current_user)
    return WatchlistListResponse(items=[_watchlist_out(w) for w in items])


@router.post("", response_model=WatchlistOut, status_code=status.HTTP_201_CREATED)
def create_watchlist(
    payload: WatchlistCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistOut:
    try:
        wl = watchlist_service.create_watchlist(
            db, user=current_user, name=payload.name, make_default=payload.make_default
        )
    except WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _watchlist_out(wl)


@router.patch("/{watchlist_id}", response_model=WatchlistOut)
def update_watchlist(
    watchlist_id: int,
    payload: WatchlistUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistOut:
    try:
        wl = watchlist_service.update_watchlist(
            db,
            user=current_user,
            watchlist_id=watchlist_id,
            name=payload.name,
            is_default=payload.is_default,
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _watchlist_out(wl)


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        watchlist_service.delete_watchlist(
            db, user=current_user, watchlist_id=watchlist_id
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.get("/{watchlist_id}/items", response_model=WatchlistItemsResponse)
def list_items(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistItemsResponse:
    try:
        wl, items = watchlist_service.list_items(
            db, user=current_user, watchlist_id=watchlist_id
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WatchlistItemsResponse(
        watchlist=_watchlist_out(wl),
        items=[_item_out(db, i) for i in items],
    )


@router.post(
    "/{watchlist_id}/items",
    response_model=WatchlistItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_item(
    watchlist_id: int,
    payload: WatchlistItemCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistItemOut:
    try:
        item = watchlist_service.add_item(
            db,
            user=current_user,
            watchlist_id=watchlist_id,
            canonical_id=payload.canonical_id,
            underlying=payload.underlying,
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _item_out(db, item)


@router.post(
    "/default/items",
    response_model=WatchlistItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_item_default(
    payload: WatchlistItemCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistItemOut:
    wl = watchlist_service.ensure_default_watchlist(db, user=current_user)
    item = watchlist_service.add_item(
        db,
        user=current_user,
        watchlist_id=wl.id,
        canonical_id=payload.canonical_id,
        underlying=payload.underlying,
    )
    return _item_out(db, item)


@router.delete(
    "/{watchlist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_item(
    watchlist_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        watchlist_service.remove_item(
            db, user=current_user, watchlist_id=watchlist_id, item_id=item_id
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.post("/{watchlist_id}/items/reorder", status_code=status.HTTP_200_OK)
def reorder_items(
    watchlist_id: int,
    payload: WatchlistReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        watchlist_service.reorder_items(
            db,
            user=current_user,
            watchlist_id=watchlist_id,
            item_ids=payload.item_ids,
        )
    except WatchlistNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}
