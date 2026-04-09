from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.instruments.types import Exchange, InstrumentType, OptionType, Segment
from app.models.user import User
from app.schemas.instrument import (
    DerivativeExpiriesResponse,
    DerivativeStrikesResponse,
    InstrumentOut,
    InstrumentSearchResponse,
    InstrumentSyncRequest,
    InstrumentSyncResponse,
)
from app.services.instrument_registry_service import instrument_registry_service
from app.services.instrument_sync_service import instrument_sync_service

router = APIRouter(prefix="/instruments", tags=["instruments"])


@router.get("/search", response_model=InstrumentSearchResponse)
def search(
    q: str = Query(min_length=1),
    limit: int = Query(default=25, ge=1, le=100),
    exchange: Exchange | None = None,
    segment: Segment | None = None,
    instrument_type: InstrumentType | None = None,
    option_type: OptionType | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> InstrumentSearchResponse:
    items = instrument_registry_service.search(
        db,
        q=q,
        limit=limit,
        exchange=exchange,
        segment=segment,
        instrument_type=instrument_type,
        option_type=option_type,
    )
    return InstrumentSearchResponse(
        items=[InstrumentOut.model_validate(i, from_attributes=True) for i in items]
    )


@router.get("/derivatives/expiries", response_model=DerivativeExpiriesResponse)
def derivative_expiries(
    underlying: str = Query(min_length=1),
    exchange: Exchange = Exchange.NSE_FNO,
    instrument_type: InstrumentType = InstrumentType.OPTION,
    limit: int = Query(default=40, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DerivativeExpiriesResponse:
    expiries = instrument_registry_service.list_expiries(
        db,
        underlying=underlying,
        exchange=exchange,
        instrument_type=instrument_type,
        limit=limit,
    )
    return DerivativeExpiriesResponse(
        underlying=underlying.strip().upper(),
        exchange=exchange,
        instrument_type=instrument_type,
        expiries=expiries,
    )


@router.get("/derivatives/strikes", response_model=DerivativeStrikesResponse)
def derivative_strikes(
    underlying: str = Query(min_length=1),
    expiry: date = Query(),
    exchange: Exchange = Exchange.NSE_FNO,
    option_type: OptionType | None = None,
    limit: int = Query(default=400, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DerivativeStrikesResponse:
    strikes = instrument_registry_service.list_strikes(
        db,
        underlying=underlying,
        exchange=exchange,
        expiry=expiry,
        option_type=option_type,
        limit=limit,
    )
    return DerivativeStrikesResponse(
        underlying=underlying.strip().upper(),
        exchange=exchange,
        expiry=expiry,
        option_type=option_type,
        strikes=strikes,
    )


@router.get("/derivatives/options", response_model=InstrumentSearchResponse)
def derivative_options(
    underlying: str = Query(min_length=1),
    expiry: date = Query(),
    exchange: Exchange = Exchange.NSE_FNO,
    option_type: OptionType | None = None,
    limit: int = Query(default=400, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> InstrumentSearchResponse:
    items = instrument_registry_service.list_options(
        db,
        underlying=underlying,
        exchange=exchange,
        expiry=expiry,
        option_type=option_type,
        limit=limit,
    )
    return InstrumentSearchResponse(
        items=[InstrumentOut.model_validate(i, from_attributes=True) for i in items]
    )


@router.post("/sync/angel-master", response_model=InstrumentSyncResponse)
def sync_angel_master(
    payload: InstrumentSyncRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> InstrumentSyncResponse:
    try:
        result = instrument_sync_service.sync_angel_master(
            db,
            scope=payload.scope,
            underlyings=payload.underlyings,
            max_rows=payload.max_rows,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Instrument sync failed",
        ) from exc

    return InstrumentSyncResponse(
        source="angel_master",
        scope=payload.scope,
        processed=result.processed,
        ingested=result.ingested,
        skipped=result.skipped,
    )


@router.get("/{canonical_id}", response_model=InstrumentOut)
def get_instrument(
    canonical_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> InstrumentOut:
    instrument = instrument_registry_service.get_by_canonical_id(db, canonical_id)
    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Instrument not found"
        )
    return InstrumentOut.model_validate(instrument, from_attributes=True)
