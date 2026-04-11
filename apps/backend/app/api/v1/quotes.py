from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.brokers.types import BrokerKey
from app.db.session import get_db
from app.models.user import User
from app.schemas.quote import QuoteOut, QuotesResponse
from app.services.quote_service import quote_service

router = APIRouter(tags=["quotes"])


@router.get("/quotes", response_model=QuotesResponse)
def get_quotes(
    canonical_ids: list[str] = Query(default_factory=list),
    broker: BrokerKey | None = Query(default=None),
    refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> QuotesResponse:
    if broker:
        effective_broker = broker
    else:
        try:
            effective_broker = BrokerKey(
                str(user.last_used_broker or BrokerKey.angel.value)
            )
        except Exception:
            effective_broker = BrokerKey.angel

    quotes, warning = quote_service.get_quotes(
        db,
        user,
        broker=effective_broker,
        canonical_ids=canonical_ids,
        refresh=refresh,
    )

    items: list[QuoteOut] = []
    for q in quotes:
        items.append(
            QuoteOut(
                canonical_id=q.canonical_id,
                ltp=q.last_price,
                change=q.change,
                change_percent=q.change_percent,
                previous_close=q.previous_close,
                as_of=q.as_of,
            )
        )

    return QuotesResponse(broker=effective_broker.value, items=items, warning=warning)
