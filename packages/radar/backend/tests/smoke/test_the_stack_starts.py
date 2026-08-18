"""The links that have to hold before anything else can be tried.

Each one is its own test, on purpose. A single end-to-end test that fails on
step four tells you the whole thing failed; these tell you which link broke.
That is the point of running them in this order: migrations, then profile,
then the API.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, inspect

pytestmark = pytest.mark.smoke

_BACKEND = Path(__file__).resolve().parents[2]

# Tables the application cannot run without. Not the full list: this is a
# smoke test, and pinning every table would turn it into a schema snapshot
# that fails on every legitimate migration.
_ESSENTIAL_TABLES = {"sources", "research_items", "configuration", "ingestion_runs"}


@pytest.fixture
def migrated(schema_at_head: str, sync_database_url: str) -> str:
    """The migrated database, ready to inspect over the sync driver.

    Applying the migrations is `schema_at_head` in the conftest, autouse for
    the whole suite: every file here needs the schema, so no single file
    should be the one that happens to create it.
    """
    return sync_database_url


class TestMigrationsApplyToPostgres:
    """The unit suite runs on SQLite. Nothing there proves these apply here.

    The two disagree in exactly the places a migration is most likely to go
    wrong: JSONB, check constraints, and altering a column after the fact.
    """

    def test_the_schema_reaches_head(self, migrated: str) -> None:
        engine = create_engine(migrated)
        try:
            tables = set(inspect(engine).get_table_names())
        finally:
            engine.dispose()

        assert tables >= _ESSENTIAL_TABLES

    def test_the_columns_added_by_later_migrations_are_there(self, migrated: str) -> None:
        """A migration that applies cleanly and adds nothing would still pass
        the check above."""
        engine = create_engine(migrated)
        try:
            columns = {col["name"] for col in inspect(engine).get_columns("research_items")}
        finally:
            engine.dispose()

        assert "injection_scan" in columns


class TestTheActiveProfileLoads:
    """A profile that fails to load takes the whole instance with it, and it
    fails at start-up rather than at import, so no unit test sees it."""

    def test_the_profile_named_by_configuration_is_readable(self) -> None:
        from app.profiles.active import get_active_profile

        profile = get_active_profile()

        assert profile.id
        assert profile.enabled_sources

    def test_the_profile_declares_when_a_signal_is_worth_delivering(self) -> None:
        """Since KRD-TSK-0011 the digest reads this rather than a constant, so
        a profile without it would leave delivery undefined."""
        from app.profiles.active import get_active_profile

        delivery = get_active_profile().delivery

        assert delivery.score_threshold >= 0
        assert delivery.max_items >= 1


class TestTheApiAnswers:
    async def test_health_reports_the_service_is_up(self, migrated: str) -> None:
        """Built against the real app object, not a stripped-down one: an
        import error anywhere in the router tree shows up right here."""
        from app.main import app

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            response = await client.get("/health")

        assert response.status_code == 200
