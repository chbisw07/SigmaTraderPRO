from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.brokers.base import BrokerError, BrokerNotConfiguredError
from app.brokers.types import BrokerKey
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.models.user import User
from app.schemas.broker import (
    AngelConnectIn,
    AngelSettingsIn,
    BrokerLoginUrlOut,
    BrokerStatusOut,
    ZerodhaConnectIn,
    ZerodhaSettingsIn,
)
from app.services.broker_service import broker_service

router = APIRouter(prefix="/brokers", tags=["brokers"])
logger = get_logger(__name__)


@router.get("/status", response_model=list[BrokerStatusOut])
def list_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BrokerStatusOut]:
    statuses = broker_service.list_statuses(db, current_user)
    return [BrokerStatusOut.model_validate(s, from_attributes=True) for s in statuses]


@router.get("/angel/status", response_model=BrokerStatusOut)
def angel_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    s = broker_service.status(db, current_user, broker=BrokerKey.angel)
    return BrokerStatusOut.model_validate(s, from_attributes=True)


@router.put("/angel/settings", response_model=BrokerStatusOut)
def angel_upsert_settings(
    payload: AngelSettingsIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    try:
        s = broker_service.upsert_settings(
            db, current_user, broker=BrokerKey.angel, payload=payload.model_dump()
        )
        log_event(
            logger,
            "broker_settings_updated",
            category="broker",
            event_type="settings",
            broker=BrokerKey.angel.value,
            user_id=current_user.id,
        )
        return BrokerStatusOut.model_validate(s, from_attributes=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.post("/angel/connect", response_model=BrokerStatusOut)
def angel_connect(
    payload: AngelConnectIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    try:
        s = broker_service.connect(
            db, current_user, broker=BrokerKey.angel, payload=payload.model_dump()
        )
        return BrokerStatusOut.model_validate(s, from_attributes=True)
    except BrokerNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except BrokerError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.post("/angel/reconnect", response_model=BrokerStatusOut)
def angel_reconnect(
    payload: AngelConnectIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    return angel_connect(payload, db, current_user)


@router.post("/angel/disconnect", response_model=BrokerStatusOut)
def angel_disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    s = broker_service.disconnect(db, current_user, broker=BrokerKey.angel)
    return BrokerStatusOut.model_validate(s, from_attributes=True)


@router.get("/zerodha/status", response_model=BrokerStatusOut)
def zerodha_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    s = broker_service.status(db, current_user, broker=BrokerKey.zerodha)
    return BrokerStatusOut.model_validate(s, from_attributes=True)


@router.put("/zerodha/settings", response_model=BrokerStatusOut)
def zerodha_upsert_settings(
    payload: ZerodhaSettingsIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    try:
        s = broker_service.upsert_settings(
            db, current_user, broker=BrokerKey.zerodha, payload=payload.model_dump()
        )
        log_event(
            logger,
            "broker_settings_updated",
            category="broker",
            event_type="settings",
            broker=BrokerKey.zerodha.value,
            user_id=current_user.id,
        )
        return BrokerStatusOut.model_validate(s, from_attributes=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.post("/zerodha/connect", response_model=BrokerStatusOut)
def zerodha_connect(
    payload: ZerodhaConnectIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    try:
        s = broker_service.connect(
            db, current_user, broker=BrokerKey.zerodha, payload=payload.model_dump()
        )
        return BrokerStatusOut.model_validate(s, from_attributes=True)
    except BrokerNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except BrokerError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.post("/zerodha/reconnect", response_model=BrokerStatusOut)
def zerodha_reconnect(
    payload: ZerodhaConnectIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    return zerodha_connect(payload, db, current_user)


@router.post("/zerodha/disconnect", response_model=BrokerStatusOut)
def zerodha_disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerStatusOut:
    s = broker_service.disconnect(db, current_user, broker=BrokerKey.zerodha)
    return BrokerStatusOut.model_validate(s, from_attributes=True)


@router.get("/zerodha/login-url", response_model=BrokerLoginUrlOut)
def zerodha_login_url(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrokerLoginUrlOut:
    adapter = broker_service.get_adapter(BrokerKey.zerodha)
    # Adapter-specific helper is intentionally not in the generic contract.
    url = adapter.get_login_url(db, current_user)  # type: ignore[attr-defined]
    return BrokerLoginUrlOut(url=url)
