from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.instruments.types import Exchange, InstrumentType, OptionType, Segment
from app.models.user import User
from app.schemas.instrument import InstrumentOut, InstrumentSearchResponse
from app.services.instrument_registry_service import instrument_registry_service

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
