from __future__ import annotations

from sqlalchemy.orm import Session

from app.brokers.angel_adapter import AngelAdapter
from app.brokers.base import BrokerAdapter, BrokerError
from app.brokers.types import BrokerKey, BrokerStatus
from app.brokers.zerodha_adapter import ZerodhaAdapter
from app.models.user import User


class BrokerService:
    def __init__(self, *, adapters: dict[BrokerKey, BrokerAdapter] | None = None):
        self._adapters: dict[BrokerKey, BrokerAdapter] = adapters or {
            BrokerKey.angel: AngelAdapter(),
            BrokerKey.zerodha: ZerodhaAdapter(),
        }

    def list_adapters(self) -> list[BrokerAdapter]:
        return list(self._adapters.values())

    def get_adapter(self, broker: BrokerKey) -> BrokerAdapter:
        adapter = self._adapters.get(broker)
        if not adapter:
            raise BrokerError(f"Unknown broker: {broker}")
        return adapter

    def status(self, db: Session, user: User, *, broker: BrokerKey) -> BrokerStatus:
        return self.get_adapter(broker).get_status(db, user)

    def list_statuses(self, db: Session, user: User) -> list[BrokerStatus]:
        return [adapter.get_status(db, user) for adapter in self.list_adapters()]

    def upsert_settings(
        self, db: Session, user: User, *, broker: BrokerKey, payload: dict
    ) -> BrokerStatus:
        return self.get_adapter(broker).upsert_settings(db, user, payload=payload)

    def connect(
        self, db: Session, user: User, *, broker: BrokerKey, payload: dict
    ) -> BrokerStatus:
        return self.get_adapter(broker).connect(db, user, payload=payload)

    def reconnect(
        self, db: Session, user: User, *, broker: BrokerKey, payload: dict
    ) -> BrokerStatus:
        return self.get_adapter(broker).reconnect(db, user, payload=payload)

    def disconnect(self, db: Session, user: User, *, broker: BrokerKey) -> BrokerStatus:
        return self.get_adapter(broker).disconnect(db, user)


broker_service = BrokerService()
