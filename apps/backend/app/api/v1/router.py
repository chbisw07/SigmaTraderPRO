from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.brokers import router as brokers_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(brokers_router)
