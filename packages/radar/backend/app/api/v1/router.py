from fastapi import APIRouter

from app.api.v1.analytics import router as analytics_router
from app.api.v1.auth import router as auth_router
from app.api.v1.configuration import router as configuration_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.digests import router as digests_router
from app.api.v1.signals import router as signals_router
from app.api.v1.sources import router as sources_router

api_v1_router = APIRouter()

api_v1_router.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
api_v1_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_v1_router.include_router(signals_router, prefix="/signals", tags=["signals"])
api_v1_router.include_router(sources_router, prefix="/sources", tags=["sources"])
api_v1_router.include_router(configuration_router, prefix="/configuration", tags=["configuration"])
api_v1_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
api_v1_router.include_router(digests_router, prefix="/digests", tags=["digests"])
