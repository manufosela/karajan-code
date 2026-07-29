"""Tests for the IngestionRun SQLAlchemy model."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingestion_run import IngestionRun
from app.models.source import Source


@pytest.fixture
async def source_for_runs(test_session: AsyncSession) -> Source:
    """Insert a source for ingestion run tests."""
    source = Source(name="Run Source", source_type="api", category="core")
    test_session.add(source)
    await test_session.flush()
    return source


@pytest.mark.asyncio
async def test_create_ingestion_run_defaults(test_session: AsyncSession, source_for_runs):
    """Create an ingestion run with defaults."""
    run = IngestionRun(source_id=source_for_runs.id)
    test_session.add(run)
    await test_session.flush()

    assert run.id is not None
    assert run.source_id == source_for_runs.id
    assert run.status == "running"  # default
    assert run.items_fetched == 0
    assert run.items_new == 0
    assert run.items_duplicate == 0
    assert run.items_processed == 0
    assert run.errors == []
    assert run.completed_at is None


@pytest.mark.asyncio
async def test_create_ingestion_run_completed(test_session: AsyncSession, source_for_runs):
    """Create a completed ingestion run with stats."""
    now = datetime.now(UTC)
    run = IngestionRun(
        source_id=source_for_runs.id,
        status="completed",
        items_fetched=50,
        items_new=30,
        items_duplicate=15,
        items_processed=30,
        completed_at=now,
        errors=[],
    )
    test_session.add(run)
    await test_session.flush()

    result = await test_session.get(IngestionRun, run.id)
    assert result.status == "completed"
    assert result.items_fetched == 50
    assert result.items_new == 30
    assert result.items_duplicate == 15
    assert result.items_processed == 30
    assert result.completed_at is not None


@pytest.mark.asyncio
async def test_ingestion_run_with_errors(test_session: AsyncSession, source_for_runs):
    """Create a failed ingestion run with error details."""
    run = IngestionRun(
        source_id=source_for_runs.id,
        status="failed",
        items_fetched=10,
        items_new=5,
        items_duplicate=0,
        items_processed=3,
        errors=[
            {"message": "Timeout after 30s", "item_id": "abc123"},
            {"message": "Invalid response format", "item_id": "def456"},
        ],
    )
    test_session.add(run)
    await test_session.flush()

    result = await test_session.get(IngestionRun, run.id)
    assert result.status == "failed"
    assert len(result.errors) == 2
    assert result.errors[0]["message"] == "Timeout after 30s"


@pytest.mark.asyncio
async def test_ingestion_run_source_relationship(test_session: AsyncSession, source_for_runs):
    """IngestionRun.source relationship."""
    run = IngestionRun(source_id=source_for_runs.id)
    test_session.add(run)
    await test_session.flush()

    await test_session.refresh(run)
    assert run.source is not None
    assert run.source.id == source_for_runs.id
    assert run.source.name == "Run Source"


@pytest.mark.asyncio
async def test_source_has_ingestion_runs(test_session: AsyncSession, source_for_runs):
    """Source.ingestion_runs back-populates correctly."""
    run1 = IngestionRun(source_id=source_for_runs.id, status="completed")
    run2 = IngestionRun(source_id=source_for_runs.id, status="running")
    test_session.add_all([run1, run2])
    await test_session.flush()

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    result = await test_session.execute(
        select(Source).where(Source.id == source_for_runs.id).options(selectinload(Source.ingestion_runs))
    )
    refreshed = result.scalar_one()
    assert len(refreshed.ingestion_runs) == 2


@pytest.mark.asyncio
async def test_ingestion_run_query_by_status(test_session: AsyncSession, source_for_runs):
    """Query ingestion runs by status."""
    run1 = IngestionRun(source_id=source_for_runs.id, status="completed")
    run2 = IngestionRun(source_id=source_for_runs.id, status="failed")
    run3 = IngestionRun(source_id=source_for_runs.id, status="completed")
    test_session.add_all([run1, run2, run3])
    await test_session.flush()

    result = await test_session.execute(
        select(IngestionRun).where(IngestionRun.status == "completed")
    )
    completed = result.scalars().all()
    assert len(completed) == 2


@pytest.mark.asyncio
async def test_ingestion_run_repr(test_session: AsyncSession, source_for_runs):
    """IngestionRun.__repr__ should return meaningful string."""
    run = IngestionRun(source_id=source_for_runs.id)
    test_session.add(run)
    await test_session.flush()

    repr_str = repr(run)
    assert "IngestionRun" in repr_str
    assert "running" in repr_str
