from __future__ import annotations

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from app.brokers.types import BrokerKey, BrokerStatus
from app.models.user import User
from app.orders.types import (
    DerivativeOrderRequest,
    DerivativeOrderResult,
    EquityOrderRequest,
    EquityOrderResult,
    ExternalBrokerOrder,
    ExternalBrokerPosition,
)


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

    @abstractmethod
    def place_equity_order(
        self, db: Session, user: User, *, request: EquityOrderRequest
    ) -> EquityOrderResult:
        raise NotImplementedError

    @abstractmethod
    def place_derivative_order(
        self, db: Session, user: User, *, request: DerivativeOrderRequest
    ) -> DerivativeOrderResult:
        raise NotImplementedError

    @abstractmethod
    def fetch_recent_orders(self, db: Session, user: User) -> list[ExternalBrokerOrder]:
        """
        Fetch broker orderbook (recent/practically accessible orders).

        Broker remains the truth for lifecycle/status; this is used to populate
        the unified Orders workspace. Implementations must not return secrets.
        """
        raise NotImplementedError

    @abstractmethod
    def fetch_positions(self, db: Session, user: User) -> list[ExternalBrokerPosition]:
        """
        Fetch broker positionbook (net positions).

        Broker remains the truth for open positions; this is used to improve the
        local Positions ledger. Implementations must not return secrets.
        """
        raise NotImplementedError
