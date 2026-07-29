"""Tests for dashboard endpoints."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.research_item import ResearchItem
from app.models.source import Source


async def _create_source(session: AsyncSession, **overrides: Any) -> Source:
    """Helper to create a Source record in the test DB."""
    defaults = {
        "id": uuid.uuid4(),
        "name": "Test PubMed",
        "source_type": "api",
        "category": "core",
        "priority": 1,
        "enabled": True,
        "config": {},
        "base_url": "https://example.com",
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    source = Source(**defaults)
    session.add(source)
    await session.flush()
    return source


async def _create_research_item(session: AsyncSession, source_id: uuid.UUID, **overrides: Any) -> ResearchItem:
    """Helper to create a ResearchItem record in the test DB."""
    defaults = {
        "id": uuid.uuid4(),
        "source_id": source_id,
        "original_title": "Test article on orthodontics",
        "document_type": "paper",
        "review_status": "review",
        "language": "en",
        "thematic_tags": [],
        "strategic_buckets": [],
        "authors": [],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    item = ResearchItem(**defaults)
    session.add(item)
    await session.flush()
    return item


class TestDashboardStats:
    """Tests for GET /api/v1/dashboard/stats."""

    async def test_stats_empty_db(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns zeros and empty dicts when no data exists."""
        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_signals"] == 0
        assert data["signals_by_status"] == {}
        assert data["signals_by_theme"] == {}
        assert data["signals_by_bucket"] == {}
        assert data["avg_scores"]["scientific"] is None
        assert data["avg_scores"]["strategic"] is None
        assert data["recent_activity"] == []

    async def test_stats_response_schema(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Response has the expected top-level keys."""
        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        expected_keys = {
            "total_signals",
            "signals_by_status",
            "signals_by_theme",
            "signals_by_bucket",
            "avg_scores",
            "recent_activity",
        }
        assert set(data.keys()) == expected_keys

    async def test_stats_total_signals(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """total_signals reflects the number of items in the DB."""
        source = await _create_source(test_session)
        for _ in range(3):
            await _create_research_item(test_session, source.id)
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        assert response.json()["total_signals"] == 3

    async def test_stats_by_status(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """signals_by_status groups items by review_status."""
        source = await _create_source(test_session)
        await _create_research_item(test_session, source.id, review_status="review")
        await _create_research_item(test_session, source.id, review_status="review")
        await _create_research_item(test_session, source.id, review_status="relevant")
        await _create_research_item(test_session, source.id, review_status="discarded")
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        by_status = response.json()["signals_by_status"]
        assert by_status["review"] == 2
        assert by_status["relevant"] == 1
        assert by_status["discarded"] == 1

    async def test_stats_by_theme(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """signals_by_theme counts occurrences across thematic_tags arrays."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session, source.id, thematic_tags=["aligners", "biomaterials"]
        )
        await _create_research_item(
            test_session, source.id, thematic_tags=["aligners", "AI"]
        )
        await _create_research_item(
            test_session, source.id, thematic_tags=["biomaterials"]
        )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        by_theme = response.json()["signals_by_theme"]
        assert by_theme["aligners"] == 2
        assert by_theme["biomaterials"] == 2
        assert by_theme["AI"] == 1

    async def test_stats_by_bucket(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """signals_by_bucket counts occurrences across strategic_buckets arrays."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session, source.id, strategic_buckets=["invest", "explore"]
        )
        await _create_research_item(
            test_session, source.id, strategic_buckets=["invest"]
        )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        by_bucket = response.json()["signals_by_bucket"]
        assert by_bucket["invest"] == 2
        assert by_bucket["explore"] == 1

    async def test_stats_avg_scores(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """avg_scores computes averages of scientific and strategic scores."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("8.0"),
            strategic_relevance_score=Decimal("6.0"),
        )
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("4.0"),
            strategic_relevance_score=Decimal("2.0"),
        )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        avg = response.json()["avg_scores"]
        assert avg["scientific"] == 6.0
        assert avg["strategic"] == 4.0

    async def test_stats_avg_scores_partial(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """avg_scores handles items with only one score set."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("7.0"),
            strategic_relevance_score=None,
        )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        avg = response.json()["avg_scores"]
        assert avg["scientific"] == 7.0
        assert avg["strategic"] is None

    async def test_stats_recent_activity(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """recent_activity returns items ordered by created_at descending."""
        source = await _create_source(test_session)
        older = await _create_research_item(
            test_session,
            source.id,
            original_title="Older article",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
        )
        newer = await _create_research_item(
            test_session,
            source.id,
            original_title="Newer article",
            created_at=datetime(2025, 6, 1, tzinfo=UTC),
        )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        activity = response.json()["recent_activity"]
        assert len(activity) == 2
        assert activity[0]["title"] == "Newer article"
        assert activity[1]["title"] == "Older article"
        # Check expected keys
        assert set(activity[0].keys()) == {"id", "title", "status", "created_at"}

    async def test_stats_recent_activity_limit(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """recent_activity returns at most 10 items."""
        source = await _create_source(test_session)
        for i in range(15):
            await _create_research_item(
                test_session,
                source.id,
                original_title=f"Article {i}",
            )
        await test_session.commit()

        response = await client.get("/api/v1/dashboard/stats", headers=auth_headers)
        activity = response.json()["recent_activity"]
        assert len(activity) == 10
