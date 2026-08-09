"""Fixtures for the smoke suite.

Everything here exists to make the tests run against the real thing. The unit
suite uses SQLite in memory and doubles almost everything, which is what makes
it fast and also what leaves this gap: nothing checks that the migrations
apply to PostgreSQL, that the profile loads, or that the pieces fit together
at start-up.

So this suite refuses to run on anything but a real PostgreSQL. Falling back
to SQLite would produce a green smoke suite that proves nothing -- worse than
no smoke suite, because it would be believed.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

pytestmark = pytest.mark.smoke

_ASYNC_PREFIX = "postgresql+asyncpg://"


def _require_postgres() -> str:
    """The database URL, or a skip explaining how to get one.

    A skip rather than a failure: someone running the suite on a laptop with
    no database up has not broken anything. The message says what to do,
    because "0 collected" teaches nobody.
    """
    url = os.environ.get("DATABASE_URL", "")

    if not url.startswith(_ASYNC_PREFIX):
        pytest.skip(
            "smoke tests need a real PostgreSQL: set DATABASE_URL to a "
            f"{_ASYNC_PREFIX}... value (locally: `make smoke`, which starts "
            "the db service with docker compose)",
            allow_module_level=True,
        )

    return url


@pytest.fixture(scope="session")
def database_url() -> str:
    """The live PostgreSQL this suite runs against."""
    return _require_postgres()


@pytest.fixture(scope="session")
def sync_database_url(database_url: str) -> str:
    """The same database over the sync driver, for inspecting the schema.

    Alembic is not given this: it receives the async URL and converts it
    itself, in ``alembic/env.py``, which is the conversion that matters. This
    one only serves the inspector here, so the two cannot drift into
    disagreeing about which database was migrated -- it is the same URL.
    """
    return database_url.replace(_ASYNC_PREFIX, "postgresql+psycopg://")


@pytest.fixture
async def session(database_url: str) -> AsyncGenerator[AsyncSession, None]:
    """A session on the live database.

    No transaction rollback wrapper: these tests are meant to leave rows
    behind and read them back the way the application does, rather than
    inspect a transaction only they can see.
    """
    engine = create_async_engine(database_url)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as live_session:
        yield live_session

    await engine.dispose()
