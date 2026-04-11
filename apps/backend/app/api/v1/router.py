from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.brokers import router as brokers_router
from app.api.v1.instruments import router as instruments_router
from app.api.v1.orders import router as orders_router
from app.api.v1.positions import router as positions_router
from app.api.v1.quotes import router as quotes_router
from app.api.v1.watchlists import router as watchlists_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(brokers_router)
api_router.include_router(instruments_router)
api_router.include_router(orders_router)
api_router.include_router(positions_router)
api_router.include_router(quotes_router)
api_router.include_router(watchlists_router)
