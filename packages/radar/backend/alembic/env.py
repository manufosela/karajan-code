import os
import re
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

# SQLite compatibility: compile JSONB as JSON for cross-dialect migrations
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection
from sqlalchemy.ext.compiler import compiles

from alembic import context
from app.models import Base  # noqa: F401 - import all models so metadata is populated


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kwargs):
    return "JSON"


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_raw_url() -> str:
    """Get the raw DATABASE_URL from environment or app settings."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    try:
        from app.core.config import settings
        return settings.DATABASE_URL
    except Exception:
        return config.get_main_option(
            "sqlalchemy.url",
            "postgresql+psycopg://postgres:postgres@localhost:5432/ortho_frontier_radar",
        )


def _to_sync_url(url: str) -> str:
    """Convert any PostgreSQL URL to use the sync psycopg driver.

    Handles:
    - postgresql://              → postgresql+psycopg://
    - postgresql+psycopg://      → kept as-is
    - postgresql+psycopg_async://→ postgresql+psycopg://
    - postgresql+asyncpg://      → postgresql+psycopg://
    - sqlite URLs               → kept as-is
    """
    if url.startswith("sqlite"):
        return url
    return re.sub(r"^postgresql(\+\w+)?://", "postgresql+psycopg://", url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = _to_sync_url(_get_raw_url())
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with a given connection."""
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a sync engine.

    Uses psycopg (sync) for all PostgreSQL connections including Cloud SQL
    Unix sockets. SQLite uses its native sync driver.
    """
    url = _get_raw_url()

    if url.startswith("sqlite"):
        sync_url = url.replace("+aiosqlite", "") if "+aiosqlite" in url else url
    else:
        sync_url = _to_sync_url(url)

    connectable = create_engine(sync_url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        do_run_migrations(connection)

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
