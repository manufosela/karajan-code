"""Comprehensive CRUD tests for signal (research item) endpoints.

Covers: pagination (offset/limit), sorting, filtering (all params),
detail view, and review update (status + notes).
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.research_item import ResearchItem
from app.models.source import Source


async def _create_source(session: AsyncSession, **overrides: Any) -> Source:
    """Helper to create a Source record."""
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


async def _create_item(session: AsyncSession, source_id: uuid.UUID, **overrides: Any) -> ResearchItem:
    """Helper to create a ResearchItem record."""
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


# =============================================================================
# Pagination tests
# =============================================================================
class TestListSignalsPagination:
    """Tests for offset/limit pagination on GET /api/v1/signals."""

    async def test_defaults(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Default offset=0, limit=20."""
        resp = await client.get("/api/v1/signals", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["offset"] == 0
        assert data["limit"] == 20
        assert data["total"] == 0
        assert data["items"] == []

    async def test_offset_limit(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """offset/limit correctly slices result set."""
        source = await _create_source(test_session)
        for i in range(5):
            await _create_item(
                test_session,
                source.id,
                original_title=f"Item {i}",
                created_at=datetime(2024, 1, 1 + i, tzinfo=UTC),
            )
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"offset": 0, "limit": 2}, headers=auth_headers)
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 5

        resp = await client.get("/api/v1/signals", params={"offset": 3, "limit": 10}, headers=auth_headers)
        data = resp.json()
        assert len(data["items"]) == 2  # only 2 remaining
        assert data["total"] == 5

    async def test_offset_beyond_total(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Offset beyond total returns empty list."""
        source = await _create_source(test_session)
        await _create_item(test_session, source.id)
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"offset": 100}, headers=auth_headers)
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 1

    async def test_limit_max(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Limit > 100 is rejected."""
        resp = await client.get("/api/v1/signals", params={"limit": 101}, headers=auth_headers)
        assert resp.status_code == 422

    async def test_negative_offset(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Negative offset is rejected."""
        resp = await client.get("/api/v1/signals", params={"offset": -1}, headers=auth_headers)
        assert resp.status_code == 422


# =============================================================================
# Sorting tests
# =============================================================================
class TestListSignalsSorting:
    """Tests for sort_by and sort_order on GET /api/v1/signals."""

    async def test_sort_by_date_asc(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Old", publication_date=date(2023, 1, 1))
        await _create_item(test_session, source.id, original_title="New", publication_date=date(2024, 6, 1))
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"sort_by": "date", "sort_order": "asc"}, headers=auth_headers
        )
        items = resp.json()["items"]
        assert items[0]["original_title"] == "Old"
        assert items[1]["original_title"] == "New"

    async def test_sort_by_date_desc(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Old", publication_date=date(2023, 1, 1))
        await _create_item(test_session, source.id, original_title="New", publication_date=date(2024, 6, 1))
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"sort_by": "date", "sort_order": "desc"}, headers=auth_headers
        )
        items = resp.json()["items"]
        assert items[0]["original_title"] == "New"

    async def test_sort_by_score(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Low", strategic_relevance_score=Decimal("2.0")
        )
        await _create_item(
            test_session, source.id, original_title="High", strategic_relevance_score=Decimal("9.0")
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"sort_by": "score", "sort_order": "desc"}, headers=auth_headers
        )
        items = resp.json()["items"]
        assert items[0]["original_title"] == "High"

    async def test_sort_by_relevance(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Low", scientific_strength_score=Decimal("3.0")
        )
        await _create_item(
            test_session, source.id, original_title="High", scientific_strength_score=Decimal("8.0")
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"sort_by": "relevance", "sort_order": "desc"}, headers=auth_headers
        )
        items = resp.json()["items"]
        assert items[0]["original_title"] == "High"

    async def test_default_sort_created_at_desc(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Older", created_at=datetime(2024, 1, 1, tzinfo=UTC)
        )
        await _create_item(
            test_session, source.id, original_title="Newer", created_at=datetime(2024, 6, 1, tzinfo=UTC)
        )
        await test_session.commit()

        resp = await client.get("/api/v1/signals", headers=auth_headers)
        items = resp.json()["items"]
        assert items[0]["original_title"] == "Newer"

    async def test_invalid_sort_by(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        resp = await client.get("/api/v1/signals", params={"sort_by": "invalid"}, headers=auth_headers)
        assert resp.status_code == 422


# =============================================================================
# Filtering tests
# =============================================================================
class TestListSignalsFiltering:
    """Tests for each filter param on GET /api/v1/signals."""

    async def test_filter_by_theme(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session,
            source.id,
            original_title="Aligners",
            thematic_tags=["clear aligners", "orthodontics"],
        )
        await _create_item(
            test_session, source.id, original_title="Materials", thematic_tags=["biomaterials"]
        )
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"theme": "clear aligners"}, headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "Aligners"

    async def test_filter_by_bucket(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Clinical", strategic_buckets=["product_clinical"]
        )
        await _create_item(test_session, source.id, original_title="AI", strategic_buckets=["ai_software"])
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"bucket": "ai_software"}, headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "AI"

    async def test_filter_by_review_status(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, review_status="review")
        await _create_item(test_session, source.id, review_status="relevant")
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"review_status": "relevant"}, headers=auth_headers)
        assert resp.json()["total"] == 1

    async def test_filter_by_hype_risk(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Risky", hype_risk="high")
        await _create_item(test_session, source.id, original_title="Safe", hype_risk="low")
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"hype_risk": "high"}, headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "Risky"

    async def test_filter_by_recommended_action(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Monitor", recommended_action="monitor")
        await _create_item(
            test_session, source.id, original_title="Investigate", recommended_action="investigate"
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"recommended_action": "monitor"}, headers=auth_headers
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "Monitor"

    async def test_filter_by_date_range(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Old", publication_date=date(2023, 1, 15))
        await _create_item(test_session, source.id, original_title="Mid", publication_date=date(2024, 6, 15))
        await _create_item(test_session, source.id, original_title="New", publication_date=date(2025, 1, 15))
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals",
            params={"date_from": "2024-01-01", "date_to": "2024-12-31"},
            headers=auth_headers,
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "Mid"

    async def test_filter_min_scientific_score(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Low", scientific_strength_score=Decimal("3.0")
        )
        await _create_item(
            test_session, source.id, original_title="High", scientific_strength_score=Decimal("8.0")
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"min_scientific_score": "7.0"}, headers=auth_headers
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "High"

    async def test_filter_min_strategic_score(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(
            test_session, source.id, original_title="Low", strategic_relevance_score=Decimal("2.0")
        )
        await _create_item(
            test_session, source.id, original_title="High", strategic_relevance_score=Decimal("9.0")
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals", params={"min_strategic_score": "5.0"}, headers=auth_headers
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "High"

    async def test_filter_search_title(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="Clear aligner biomechanics study")
        await _create_item(test_session, source.id, original_title="Dental implant review")
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"search": "biomechanics"}, headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        assert "biomechanics" in data["items"][0]["original_title"].lower()

    async def test_search_case_insensitive(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        await _create_item(test_session, source.id, original_title="ORTHODONTIC TREATMENT")
        await test_session.commit()

        resp = await client.get("/api/v1/signals", params={"search": "orthodontic"}, headers=auth_headers)
        assert resp.json()["total"] == 1

    async def test_combined_filters(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Multiple filters are combined with AND logic."""
        source = await _create_source(test_session)
        await _create_item(
            test_session,
            source.id,
            original_title="Match",
            review_status="relevant",
            hype_risk="low",
            strategic_relevance_score=Decimal("8.0"),
        )
        await _create_item(
            test_session,
            source.id,
            original_title="Wrong status",
            review_status="review",
            hype_risk="low",
            strategic_relevance_score=Decimal("8.0"),
        )
        await _create_item(
            test_session,
            source.id,
            original_title="Wrong hype",
            review_status="relevant",
            hype_risk="high",
            strategic_relevance_score=Decimal("8.0"),
        )
        await test_session.commit()

        resp = await client.get(
            "/api/v1/signals",
            params={
                "review_status": "relevant",
                "hype_risk": "low",
                "min_strategic_score": "5.0",
            },
            headers=auth_headers,
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "Match"


# =============================================================================
# Detail view tests
# =============================================================================
class TestGetSignalDetail:
    """Tests for GET /api/v1/signals/{id}."""

    async def test_found_with_all_fields(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(
            test_session,
            source.id,
            original_title="Full detail article",
            doi="10.1234/test.001",
            abstract="A detailed abstract",
            publication_date=date(2024, 6, 15),
            scientific_strength_score=Decimal("7.5"),
            strategic_relevance_score=Decimal("8.0"),
            hype_risk="low",
            recommended_action="monitor",
            executive_summary_en="Summary EN",
            executive_summary_es="Resumen ES",
            reviewer_notes="Looks promising",
        )
        await test_session.commit()

        resp = await client.get(f"/api/v1/signals/{item.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(item.id)
        assert data["original_title"] == "Full detail article"
        assert data["doi"] == "10.1234/test.001"
        assert data["abstract"] == "A detailed abstract"
        assert data["publication_date"] == "2024-06-15"
        assert data["scientific_strength_score"] == "7.50"
        assert data["strategic_relevance_score"] == "8.00"
        assert data["hype_risk"] == "low"
        assert data["recommended_action"] == "monitor"
        assert data["executive_summary_en"] == "Summary EN"
        assert data["executive_summary_es"] == "Resumen ES"
        assert data["reviewer_notes"] == "Looks promising"
        assert data["review_status"] == "review"
        # Verify timestamps exist
        assert "created_at" in data
        assert "updated_at" in data

    async def test_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        fake_id = str(uuid.uuid4())
        resp = await client.get(f"/api/v1/signals/{fake_id}", headers=auth_headers)
        assert resp.status_code == 404

    async def test_invalid_uuid(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        resp = await client.get("/api/v1/signals/not-a-uuid", headers=auth_headers)
        assert resp.status_code == 422


# =============================================================================
# Review update tests
# =============================================================================
class TestReviewSignal:
    """Tests for PATCH /api/v1/signals/{id}/review."""

    async def test_update_status_only(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id, review_status="review")
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "relevant"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["review_status"] == "relevant"
        assert data["id"] == str(item.id)
        assert data["reviewer_notes"] is None

    async def test_update_status_and_notes(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id, review_status="review")
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "opportunity", "reviewer_notes": "Very promising for Q3"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["review_status"] == "opportunity"
        assert data["reviewer_notes"] == "Very promising for Q3"

    async def test_reviewer_notes_persisted(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """After updating notes, GET detail should return them."""
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id, review_status="review")
        await test_session.commit()

        await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "relevant", "reviewer_notes": "Persisted note"},
            headers=auth_headers,
        )

        resp = await client.get(f"/api/v1/signals/{item.id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["reviewer_notes"] == "Persisted note"

    async def test_invalid_status_422(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id)
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "invalid_value"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_not_found_404(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/signals/{fake_id}/review",
            json={"review_status": "relevant"},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_missing_body_422(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id)
        await test_session.commit()

        resp = await client.patch(f"/api/v1/signals/{item.id}/review", json={}, headers=auth_headers)
        assert resp.status_code == 422

    @pytest.mark.parametrize("status", ["relevant", "review", "discarded", "opportunity", "follow_up"])
    async def test_all_valid_statuses(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str], status: str
    ) -> None:
        source = await _create_source(test_session)
        item = await _create_item(test_session, source.id, review_status="review")
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": status},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["review_status"] == status
