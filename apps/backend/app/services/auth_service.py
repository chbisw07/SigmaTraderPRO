from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User


class AuthError(Exception):
    pass


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == email)).scalar_one_or_none()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if not user:
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def issue_token_pair(user: User) -> tuple[str, str]:
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    return access, refresh


def refresh_access_token(db: Session, refresh_token: str) -> tuple[User, str, str]:
    try:
        payload = decode_token(refresh_token)
    except Exception as exc:  # noqa: BLE001 - normalize token errors
        raise AuthError("invalid_refresh_token") from exc

    if payload.get("type") != "refresh":
        raise AuthError("invalid_refresh_token_type")

    try:
        user_id = int(payload["sub"])
    except Exception as exc:  # noqa: BLE001 - normalize token errors
        raise AuthError("invalid_refresh_token_subject") from exc

    user = get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise AuthError("user_not_found_or_inactive")

    access, refresh = issue_token_pair(user)
    return user, access, refresh


def update_last_used_broker(db: Session, user: User, broker: str | None) -> User:
    user.last_used_broker = broker
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email, password_hash=hash_password(password), is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
