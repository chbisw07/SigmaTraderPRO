from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.holding import HoldingsListResponse
from app.services.holdings_service import holdings_service

router = APIRouter(prefix="/holdings", tags=["holdings"])


@router.get("", response_model=HoldingsListResponse)
def list_holdings(
    broker: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HoldingsListResponse:
    return holdings_service.list(
        db,
        user=current_user,
        broker=broker,
        q=q,
        limit=limit,
    )
