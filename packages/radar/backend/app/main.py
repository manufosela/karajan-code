import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.database import engine
from app.core.logging import configure_logging, get_logger
from app.schemas.common import ErrorDetail, ErrorResponse, HealthResponse, ReadyResponse

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup and shutdown events."""
    configure_logging()
    logger.info("Starting Ortho Karajan Radar", version=settings.APP_VERSION)
    yield
    logger.info("Shutting down Ortho Karajan Radar")
    await engine.dispose()


def create_app() -> FastAPI:
    """Application factory for the FastAPI app."""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(404)
    async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error=ErrorDetail(code="NOT_FOUND", message="Resource not found", request_id=request_id)
            ).model_dump(),
        )

    @app.exception_handler(500)
    async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.error("Unhandled server error", error=str(exc), request_id=request_id)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="INTERNAL_ERROR", message="Internal server error", request_id=request_id
                )
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.error(
            "Unhandled exception", error=str(exc), exc_type=type(exc).__name__, request_id=request_id
        )
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="INTERNAL_ERROR", message="An unexpected error occurred", request_id=request_id
                )
            ).model_dump(),
        )

    @app.get("/health", response_model=HealthResponse, tags=["health"])
    async def health_check() -> HealthResponse:
        """Health check endpoint.

        Returns 200 even if the database is degraded, so the platform does not
        kill the instance while it is still able to serve reads.
        """
        from datetime import datetime

        db_status = "ok"
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception as e:
            db_status = f"error: {e}"
            logger.warning("Database health check failed", error=str(e))

        return HealthResponse(
            status="ok" if db_status == "ok" else "degraded",
            version=settings.APP_VERSION,
            database=db_status,
            timestamp=datetime.now(UTC),
        )

    @app.get("/ready", response_model=ReadyResponse, tags=["health"])
    async def readiness_check() -> ReadyResponse:
        """Readiness check verifying all dependencies are available."""
        checks: dict[str, bool] = {}

        # Database check
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["database"] = True
        except Exception:
            checks["database"] = False

        ready = all(checks.values())
        return ReadyResponse(ready=ready, checks=checks)

    app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)

    return app


app = create_app()
