"""Tests for the migration-head helper used by readiness and the smoke check."""

from unittest.mock import AsyncMock

from app.core.migrations import code_head_revision, schema_at_head


def test_code_head_revision_is_defined() -> None:
    """The code ships migrations, so there is a head revision to compare against."""
    assert code_head_revision() is not None


class TestSchemaAtHead:
    """schema_at_head compares the DB revision with the code head, read-only."""

    async def test_true_when_db_at_head(self) -> None:
        """When the DB revision equals the code head, the schema is up to date."""
        head = code_head_revision()
        conn = AsyncMock()
        conn.run_sync = AsyncMock(return_value=head)

        assert await schema_at_head(conn) is True

    async def test_false_when_db_behind(self) -> None:
        """A DB on an older revision is not at head."""
        conn = AsyncMock()
        conn.run_sync = AsyncMock(return_value="0001_something_old")

        assert await schema_at_head(conn) is False

    async def test_false_when_db_unmigrated(self) -> None:
        """An empty alembic_version (None) means the DB was never migrated."""
        conn = AsyncMock()
        conn.run_sync = AsyncMock(return_value=None)

        assert await schema_at_head(conn) is False
