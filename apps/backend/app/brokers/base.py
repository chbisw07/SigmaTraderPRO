from __future__ import annotations

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from app.brokers.types import BrokerKey, BrokerStatus
from app.models.user import User


class BrokerError(RuntimeError):
    pass


class BrokerNotConfiguredError(BrokerError):
    pass


class BrokerAdapter(ABC):
    key: BrokerKey
    display_name: str

    @abstractmethod
    def get_status(self, db: Session, user: User) -> BrokerStatus:
        raise NotImplementedError

    @abstractmethod
    def upsert_settings(
        self, db: Session, user: User, *, payload: dict
    ) -> BrokerStatus:
        raise NotImplementedError

    @abstractmethod
    def connect(self, db: Session, user: User, *, payload: dict) -> BrokerStatus:
        raise NotImplementedError

    @abstractmethod
    def reconnect(self, db: Session, user: User, *, payload: dict) -> BrokerStatus:
        raise NotImplementedError

    @abstractmethod
    def disconnect(self, db: Session, user: User) -> BrokerStatus:
        raise NotImplementedError
