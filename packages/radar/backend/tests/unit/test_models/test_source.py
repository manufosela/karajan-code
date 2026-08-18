"""Tests for the Source SQLAlchemy model."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.source import Source


@pytest.mark.asyncio
async def test_create_source_minimal(test_session: AsyncSession):
    """Create a source with only required fields."""
    source = Source(
        name="Test Source",
        source_type="api",
        category="core",
    )
    test_session.add(source)
    await test_session.flush()

    assert source.id is not None
    assert source.name == "Test Source"
    assert source.source_type == "api"
    assert source.category == "core"
    assert source.priority == 5  # default
    assert source.enabled is True  # default
    assert source.config == {}  # default
    assert source.base_url is None
    assert source.last_fetched_at is None


@pytest.mark.asyncio
async def test_create_source_all_fields(test_session: AsyncSession, sample_source_data):
    """Create a source with all fields populated."""
    source = Source(**sample_source_data)
    test_session.add(source)
    await test_session.flush()

    result = await test_session.get(Source, source.id)
    assert result is not None
    assert result.name == sample_source_data["name"]
    assert result.source_type == sample_source_data["source_type"]
    assert result.category == sample_source_data["category"]
    assert result.priority == sample_source_data["priority"]
    assert result.enabled == sample_source_data["enabled"]
    assert result.base_url == sample_source_data["base_url"]
    assert result.config == sample_source_data["config"]


@pytest.mark.asyncio
async def test_source_uuid_auto_generated(test_session: AsyncSession):
    """Source.id should be auto-generated as UUID if not provided."""
    source = Source(name="Auto UUID", source_type="rss", category="journal")
    test_session.add(source)
    await test_session.flush()

    assert isinstance(source.id, uuid.UUID)


@pytest.mark.asyncio
async def test_source_repr(test_session: AsyncSession):
    """Source.__repr__ should return meaningful string."""
    source = Source(name="PubMed", source_type="api", category="core")
    test_session.add(source)
    await test_session.flush()

    repr_str = repr(source)
    assert "Source" in repr_str
    assert "PubMed" in repr_str
    assert "api" in repr_str


@pytest.mark.asyncio
async def test_source_relationships_empty(test_session: AsyncSession):
    """Source relationships should be empty lists by default."""
    source = Source(name="Empty Source", source_type="api", category="core")
    test_session.add(source)
    await test_session.flush()

    # Use refresh to trigger async selectin loading
    await test_session.refresh(source, ["research_items", "ingestion_runs"])
    assert source.research_items == []
    assert source.ingestion_runs == []


@pytest.mark.asyncio
async def test_source_query_by_category(test_session: AsyncSession):
    """Query sources by category."""
    source1 = Source(name="Core 1", source_type="api", category="core")
    source2 = Source(name="Univ 1", source_type="rss", category="university")
    test_session.add_all([source1, source2])
    await test_session.flush()

    result = await test_session.execute(select(Source).where(Source.category == "core"))
    core_sources = result.scalars().all()
    assert len(core_sources) == 1
    assert core_sources[0].name == "Core 1"


@pytest.mark.asyncio
async def test_source_update(test_session: AsyncSession):
    """Update source fields."""
    source = Source(name="Original", source_type="api", category="core")
    test_session.add(source)
    await test_session.flush()

    source.name = "Updated"
    source.priority = 3
    await test_session.flush()

    result = await test_session.get(Source, source.id)
    assert result.name == "Updated"
    assert result.priority == 3


@pytest.mark.asyncio
async def test_source_delete(test_session: AsyncSession):
    """Delete a source."""
    source = Source(name="Deletable", source_type="scraper", category="author")
    test_session.add(source)
    await test_session.flush()

    source_id = source.id
    await test_session.delete(source)
    await test_session.flush()

    result = await test_session.get(Source, source_id)
    assert result is None
