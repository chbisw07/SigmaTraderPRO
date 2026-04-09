from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.logger import get_logger, log_event
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    PreferencesUpdateRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPairResponse,
)
from app.schemas.user import UserOut
from app.services.auth_service import (
    AuthError,
    authenticate_user,
    create_user,
    issue_token_pair,
    refresh_access_token,
    update_last_used_broker,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = get_logger(__name__)


def _mask_email(email: str) -> str:
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if not local:
        return f"***@{domain}"
    return f"{local[0]}***@{domain}"


@router.post("/login", response_model=TokenPairResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    user = authenticate_user(db, payload.email, payload.password)
    if not user:
        log_event(
            logger,
            "login_failed",
            category="auth",
            event_type="login",
            email=_mask_email(str(payload.email)),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    access, refresh = issue_token_pair(user)
    user_out = UserOut.model_validate(user, from_attributes=True)
    return TokenPairResponse(access_token=access, refresh_token=refresh, user=user_out)


@router.post(
    "/register",
    response_model=TokenPairResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest, db: Session = Depends(get_db)
) -> TokenPairResponse:
    try:
        user = create_user(db, str(payload.email), payload.password)
    except IntegrityError as exc:
        log_event(
            logger,
            "register_failed",
            category="auth",
            event_type="register",
            email=_mask_email(str(payload.email)),
            error="email_exists",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        ) from exc

    access, refresh = issue_token_pair(user)
    user_out = UserOut.model_validate(user, from_attributes=True)
    return TokenPairResponse(access_token=access, refresh_token=refresh, user=user_out)


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(
    payload: RefreshRequest, db: Session = Depends(get_db)
) -> TokenPairResponse:
    try:
        user, access, refresh_token = refresh_access_token(db, payload.refresh_token)
    except AuthError as exc:
        log_event(
            logger,
            "refresh_failed",
            category="auth",
            event_type="refresh",
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        ) from exc

    user_out = UserOut.model_validate(user, from_attributes=True)
    return TokenPairResponse(
        access_token=access,
        refresh_token=refresh_token,
        user=user_out,
    )


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user, from_attributes=True)


@router.patch("/me/preferences", response_model=UserOut)
def update_preferences(
    payload: PreferencesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    updated = update_last_used_broker(db, current_user, payload.last_used_broker)
    return UserOut.model_validate(updated, from_attributes=True)
