"""Tests for the ResearchItem SQLAlchemy model."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.research_item import ResearchItem
from app.models.source import Source


@pytest.fixture
async def source_in_db(test_session: AsyncSession, sample_source_data) -> Source:
    """Insert a source into the test DB and return it."""
    source = Source(**sample_source_data)
    test_session.add(source)
    await test_session.flush()
    return source


@pytest.mark.asyncio
async def test_create_research_item_minimal(test_session: AsyncSession, source_in_db):
    """Create a research item with only required fields."""
    item = ResearchItem(
        source_id=source_in_db.id,
        original_title="Test Paper Title",
        document_type="paper",
    )
    test_session.add(item)
    await test_session.flush()

    assert item.id is not None
    assert item.source_id == source_in_db.id
    assert item.original_title == "Test Paper Title"
    assert item.document_type == "paper"
    assert item.review_status == "review"  # default
    assert item.language == "en"  # default


@pytest.mark.asyncio
async def test_create_research_item_all_fields(test_session: AsyncSession, source_in_db):
    """Create a research item with all fields populated."""
    item = ResearchItem(
        source_id=source_in_db.id,
        doi="10.1234/test.2024.001",
        pmid="12345678",
        nct_id="NCT12345678",
        arxiv_id="2401.12345",
        original_url="https://example.com/paper",
        original_title="Full Research Paper",
        normalized_title="full research paper",
        authors=[{"name": "Smith J.", "affiliation": "MIT"}],
        publication_date=date(2024, 6, 15),
        abstract="This is a test abstract.",
        journal_or_origin="Nature Orthodontics",
        document_type="review",
        language="en",
        thematic_tags=["aligners", "biomechanics"],
        strategic_buckets=["product_clinical"],
        scientific_strength_score=Decimal("8.50"),
        scientific_strength_reasons={"study_design": "RCT"},
        strategic_relevance_score=Decimal("7.25"),
        strategic_relevance_reasons={"proximity": "high"},
        hype_risk="low",
        time_horizon="short_term",
        recommended_action="investigate",
        confidence_level=Decimal("0.85"),
        facts_from_source={"sample_size": 100},
        extracted_evidence={"key_finding": "effective"},
        evidence_snippets={"snippet_1": "..."},
        strategic_interpretation={"impact": "high"},
        executive_summary_en="English summary",
        executive_summary_es="Resumen en espanol",
        why_it_matters_en="Matters because...",
        why_it_matters_es="Importa porque...",
        possible_impact_for_geniova_en="Impact for Geniova...",
        possible_impact_for_geniova_es="Impacto para Geniova...",
        review_status="relevant",
        llm_provider="anthropic",
        llm_model="claude-sonnet-4-20250514",
        llm_prompt_version="v1.0.0",
        raw_llm_input="prompt text",
        raw_llm_output="response text",
        content_hash="abc123def456",
    )
    test_session.add(item)
    await test_session.flush()

    result = await test_session.get(ResearchItem, item.id)
    assert result is not None
    assert result.doi == "10.1234/test.2024.001"
    assert result.scientific_strength_score == Decimal("8.50")
    assert result.strategic_relevance_score == Decimal("7.25")
    assert result.confidence_level == Decimal("0.85")
    assert result.authors == [{"name": "Smith J.", "affiliation": "MIT"}]
    assert result.thematic_tags == ["aligners", "biomechanics"]
    assert result.executive_summary_en == "English summary"
    assert result.executive_summary_es == "Resumen en espanol"
    assert result.llm_provider == "anthropic"
    assert result.content_hash == "abc123def456"


@pytest.mark.asyncio
async def test_research_item_content_hash_unique(test_session: AsyncSession, source_in_db):
    """content_hash must be unique across research items."""
    item1 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Paper 1",
        document_type="paper",
        content_hash="unique_hash_001",
    )
    item2 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Paper 2",
        document_type="paper",
        content_hash="unique_hash_001",  # duplicate
    )
    test_session.add(item1)
    await test_session.flush()

    test_session.add(item2)
    with pytest.raises(IntegrityError):
        await test_session.flush()


@pytest.mark.asyncio
async def test_research_item_source_relationship(test_session: AsyncSession, source_in_db):
    """ResearchItem.source relationship should point to the correct Source."""
    item = ResearchItem(
        source_id=source_in_db.id,
        original_title="Relationship Test",
        document_type="paper",
    )
    test_session.add(item)
    await test_session.flush()

    # Refresh to load relationship
    await test_session.refresh(item)
    assert item.source is not None
    assert item.source.id == source_in_db.id
    assert item.source.name == source_in_db.name


@pytest.mark.asyncio
async def test_source_has_research_items(test_session: AsyncSession, source_in_db):
    """Source.research_items should include added items."""
    item1 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Paper A",
        document_type="paper",
    )
    item2 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Paper B",
        document_type="review",
    )
    test_session.add_all([item1, item2])
    await test_session.flush()

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    result = await test_session.execute(
        select(Source).where(Source.id == source_in_db.id).options(selectinload(Source.research_items))
    )
    refreshed = result.scalar_one()
    assert len(refreshed.research_items) == 2
    titles = {ri.original_title for ri in refreshed.research_items}
    assert titles == {"Paper A", "Paper B"}


@pytest.mark.asyncio
async def test_research_item_requires_source_id(test_session: AsyncSession, source_in_db):
    """ResearchItem must have a source_id set (NOT NULL at DB level).

    Note: SQLite does not enforce FK references by default, so we test
    the NOT NULL constraint instead of FK referential integrity.
    FK enforcement is verified in the PostgreSQL migration tests.
    """
    item = ResearchItem(
        original_title="Orphan Paper",
        document_type="paper",
    )
    # source_id is NOT NULL, so omitting it should fail
    test_session.add(item)
    with pytest.raises(IntegrityError):
        await test_session.flush()


@pytest.mark.asyncio
async def test_research_item_query_by_review_status(test_session: AsyncSession, source_in_db):
    """Query research items by review_status."""
    item1 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Pending",
        document_type="paper",
        review_status="review",
    )
    item2 = ResearchItem(
        source_id=source_in_db.id,
        original_title="Approved",
        document_type="paper",
        review_status="relevant",
    )
    test_session.add_all([item1, item2])
    await test_session.flush()

    result = await test_session.execute(
        select(ResearchItem).where(ResearchItem.review_status == "relevant")
    )
    relevant = result.scalars().all()
    assert len(relevant) == 1
    assert relevant[0].original_title == "Approved"


@pytest.mark.asyncio
async def test_research_item_nullable_scores(test_session: AsyncSession, source_in_db):
    """Score fields should be nullable (not yet processed items)."""
    item = ResearchItem(
        source_id=source_in_db.id,
        original_title="Unscored Paper",
        document_type="preprint",
    )
    test_session.add(item)
    await test_session.flush()

    assert item.scientific_strength_score is None
    assert item.strategic_relevance_score is None
    assert item.confidence_level is None
    assert item.hype_risk is None
    assert item.time_horizon is None
    assert item.recommended_action is None
