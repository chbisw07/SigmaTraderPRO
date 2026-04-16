from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.logger import get_logger, log_event
from app.core.crypto import CryptoError, decrypt_json
from app.db.session import get_db
from app.instruments.types import Exchange, InstrumentType, OptionType, Segment
from app.models.broker_connection import BrokerConnection
from app.models.user import User
from app.schemas.instrument import (
    DerivativeExpiriesResponse,
    DerivativeStrikesResponse,
    InstrumentOut,
    InstrumentSearchResponse,
    InstrumentSyncRequest,
    InstrumentSyncResponse,
    ZerodhaNfoSyncRequest,
)
from app.services.instrument_registry_service import instrument_registry_service
from app.services.instrument_sync_service import (
    InstrumentSyncDatabaseError,
    InstrumentSyncDependencyError,
    InstrumentSyncUpstreamError,
    instrument_sync_service,
)

router = APIRouter(prefix="/instruments", tags=["instruments"])
logger = get_logger(__name__)

def _dev_detail(public_message: str, exc: Exception) -> str:
    env = (settings.app_env or "").strip().lower()
    if env in {"development", "dev", "local"}:
        msg = str(exc).strip().replace("\n", " ")
        msg = msg[:240] if msg else exc.__class__.__name__
        return f"{public_message}: {exc.__class__.__name__}: {msg}"
    return public_message


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
    except InstrumentSyncDatabaseError as exc:
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="angel_master",
            scope=payload.scope,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except InstrumentSyncUpstreamError as exc:
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="angel_master",
            scope=payload.scope,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="angel_master",
            scope=payload.scope,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_dev_detail("Instrument sync failed", exc),
        ) from exc

    return InstrumentSyncResponse(
        source="angel_master",
        scope=payload.scope,
        processed=result.processed,
        ingested=result.ingested,
        skipped=result.skipped,
    )


@router.post("/sync/zerodha-nfo", response_model=InstrumentSyncResponse)
def sync_zerodha_nfo(
    payload: ZerodhaNfoSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InstrumentSyncResponse:
    conn = (
        db.query(BrokerConnection)
        .filter(BrokerConnection.user_id == current_user.id)
        .filter(BrokerConnection.broker_key == "zerodha")
        .one_or_none()
    )
    if not conn or not conn.credentials_enc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zerodha is not configured. Save Zerodha settings first.",
        )

    try:
        creds = decrypt_json(conn.credentials_enc, key=settings.broker_encryption_key)
        api_key = str(creds["api_key"])
        access_token: str | None = None
        if conn.session_enc:
            session = decrypt_json(conn.session_enc, key=settings.broker_encryption_key)
            access_token = str(session.get("access_token") or "") or None
    except (CryptoError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zerodha session decrypt failed",
        ) from exc

    try:
        result = instrument_sync_service.sync_zerodha_nfo(
            db,
            api_key=api_key,
            access_token=access_token,
            underlyings=payload.underlyings,
            max_rows=payload.max_rows,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except InstrumentSyncDependencyError as exc:
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="zerodha_nfo",
            scope="fno_underlyings",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except InstrumentSyncDatabaseError as exc:
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="zerodha_nfo",
            scope="fno_underlyings",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log_event(
            logger,
            "instrument_sync_failed",
            category="instruments",
            event_type="sync",
            source="zerodha_nfo",
            scope="fno_underlyings",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_dev_detail("Zerodha instrument sync failed", exc),
        ) from exc

    return InstrumentSyncResponse(
        source="zerodha_nfo",
        scope="fno_underlyings",
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
