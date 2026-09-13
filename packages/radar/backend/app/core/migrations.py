"""Compare the database schema revision with the code's migration head.

Read-only: the readiness check and the post-deploy smoke check use this to tell
whether an instance is migrated up to the revision the running code expects. It
never writes: getting a revision is a plain read of alembic_version.
"""

from __future__ import annotations

from pathlib import Path

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import AsyncConnection

# app/core/migrations.py -> app/ -> backend/, where the alembic/ dir lives.
_ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"


def code_head_revision() -> str | None:
    """The head revision the current code ships (None if there are no migrations)."""
    return ScriptDirectory(str(_ALEMBIC_DIR)).get_current_head()


def _db_revision(sync_conn) -> str | None:
    """The revision recorded in the database (None if never migrated)."""
    return MigrationContext.configure(sync_conn).get_current_revision()


async def schema_at_head(conn: AsyncConnection) -> bool:
    """True when the database is migrated to the code's head revision."""
    db_revision = await conn.run_sync(_db_revision)
    return db_revision is not None and db_revision == code_head_revision()
