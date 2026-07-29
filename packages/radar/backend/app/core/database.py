import re
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings


def _to_async_url(url: str) -> str:
    """Convert any PostgreSQL URL to use an async-compatible driver.

    Handles these incoming formats:
    - postgresql://           → postgresql+psycopg_async://
    - postgresql+psycopg://   → postgresql+psycopg_async://  (Cloud SQL)
    - postgresql+asyncpg://   → kept as-is (local dev)
    - postgresql+psycopg_async:// → kept as-is
    """
    if "+psycopg_async://" in url or "+asyncpg://" in url:
        return url
    # Replace any postgresql[+driver]:// with postgresql+psycopg_async://
    return re.sub(r"^postgresql(\+\w+)?://", "postgresql+psycopg_async://", url)


engine = create_async_engine(
    _to_async_url(settings.DATABASE_URL),
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
