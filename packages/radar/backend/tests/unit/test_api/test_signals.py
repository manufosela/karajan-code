"""Tests for signal (research item) endpoints."""

import uuid
from datetime import UTC, date, datetime
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


async def _create_research_item(
    session: AsyncSession, source_id: uuid.UUID, **overrides: Any
) -> ResearchItem:
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


class TestListSignals:
    """Tests for GET /api/v1/signals."""

    async def test_list_signals_empty(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/signals returns empty paginated response when no data exists."""
        response = await client.get("/api/v1/signals", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["offset"] == 0
        assert data["limit"] == 20

    async def test_list_signals_with_pagination(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Pagination params (offset, limit) are respected."""
        source = await _create_source(test_session)
        # Create 5 items
        for i in range(5):
            await _create_research_item(
                test_session,
                source.id,
                original_title=f"Article {i}",
            )
        await test_session.commit()

        # Request offset=0, limit=2
        response = await client.get("/api/v1/signals", params={"offset": 0, "limit": 2}, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["offset"] == 0
        assert data["limit"] == 2

        # Request offset=4 (last item)
        response = await client.get("/api/v1/signals", params={"offset": 4, "limit": 2}, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1

    async def test_list_signals_filter_by_status(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Filter by review_status returns only matching items."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session, source.id, review_status="review", original_title="Review item"
        )
        await _create_research_item(
            test_session, source.id, review_status="relevant", original_title="Relevant item"
        )
        await _create_research_item(
            test_session, source.id, review_status="discarded", original_title="Discarded item"
        )
        await test_session.commit()

        response = await client.get(
            "/api/v1/signals", params={"review_status": "relevant"}, headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["review_status"] == "relevant"
        assert data["items"][0]["original_title"] == "Relevant item"

    async def test_list_signals_filter_by_source(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Filter by source_id returns only items from that source."""
        source_a = await _create_source(test_session, name="Source A")
        source_b = await _create_source(test_session, name="Source B")
        await _create_research_item(test_session, source_a.id, original_title="From A")
        await _create_research_item(test_session, source_b.id, original_title="From B")
        await test_session.commit()

        response = await client.get(
            "/api/v1/signals", params={"source_id": str(source_a.id)}, headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["original_title"] == "From A"

    async def test_list_signals_filter_by_document_type(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Filter by document_type returns only matching items."""
        source = await _create_source(test_session)
        await _create_research_item(test_session, source.id, document_type="paper", original_title="Article")
        await _create_research_item(test_session, source.id, document_type="review", original_title="Review")
        await test_session.commit()

        response = await client.get(
            "/api/v1/signals", params={"document_type": "review"}, headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["document_type"] == "review"

    async def test_list_signals_default_ordering(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Signals are ordered by created_at descending (newest first)."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            original_title="Older",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        await _create_research_item(
            test_session,
            source.id,
            original_title="Newer",
            created_at=datetime(2024, 6, 1, tzinfo=UTC),
        )
        await test_session.commit()

        response = await client.get("/api/v1/signals", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["items"][0]["original_title"] == "Newer"
        assert data["items"][1]["original_title"] == "Older"


class TestGetSignal:
    """Tests for GET /api/v1/signals/{signal_id}."""

    async def test_get_signal_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/signals/{uuid} returns 404 for non-existent signal."""
        fake_id = str(uuid.uuid4())
        response = await client.get(f"/api/v1/signals/{fake_id}", headers=auth_headers)

        assert response.status_code == 404
        data = response.json()
        # The global 404 handler returns ErrorResponse format
        assert "error" in data
        assert data["error"]["code"] == "NOT_FOUND"

    async def test_get_signal_invalid_uuid(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/signals/invalid returns 422 for malformed UUID."""
        response = await client.get("/api/v1/signals/not-a-uuid", headers=auth_headers)

        assert response.status_code == 422

    async def test_get_signal_found(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/signals/{id} returns full detail when signal exists."""
        source = await _create_source(test_session)
        item = await _create_research_item(
            test_session,
            source.id,
            original_title="Detailed article",
            document_type="paper",
            review_status="review",
            doi="10.1234/test.001",
            abstract="Test abstract for detail view",
            publication_date=date(2024, 6, 15),
        )
        await test_session.commit()

        response = await client.get(f"/api/v1/signals/{item.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(item.id)
        assert data["original_title"] == "Detailed article"
        assert data["document_type"] == "paper"
        assert data["review_status"] == "review"
        assert data["doi"] == "10.1234/test.001"
        assert data["abstract"] == "Test abstract for detail view"
        assert data["publication_date"] == "2024-06-15"


class TestUpdateSignalStatus:
    """Tests for PATCH /api/v1/signals/{signal_id}/review."""

    async def test_update_signal_status(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """PATCH /api/v1/signals/{id}/review changes the review status."""
        source = await _create_source(test_session)
        item = await _create_research_item(test_session, source.id, review_status="review")
        await test_session.commit()

        response = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "relevant"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["review_status"] == "relevant"
        assert data["id"] == str(item.id)

    async def test_update_signal_invalid_status(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """PATCH with invalid status value returns 422."""
        source = await _create_source(test_session)
        item = await _create_research_item(test_session, source.id, review_status="review")
        await test_session.commit()

        response = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={"review_status": "invalid_value"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_signal_status_not_found(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """PATCH on non-existent signal returns 404."""
        fake_id = str(uuid.uuid4())
        response = await client.patch(
            f"/api/v1/signals/{fake_id}/review",
            json={"review_status": "relevant"},
            headers=auth_headers,
        )
        assert response.status_code == 404
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "NOT_FOUND"

    async def test_update_signal_status_all_valid_values(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """All valid review_status values are accepted.

        relevant, review, discarded, opportunity, follow_up.
        """
        source = await _create_source(test_session)

        valid_statuses = ["relevant", "review", "discarded", "opportunity", "follow_up"]
        for status in valid_statuses:
            item = await _create_research_item(test_session, source.id, review_status="review")
            await test_session.commit()

            response = await client.patch(
                f"/api/v1/signals/{item.id}/review",
                json={"review_status": status},
                headers=auth_headers,
            )
            assert response.status_code == 200, (
                f"Status '{status}' should be accepted but got {response.status_code}"
            )
            assert response.json()["review_status"] == status

    async def test_update_signal_status_missing_body(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """PATCH with empty body returns 422."""
        source = await _create_source(test_session)
        item = await _create_research_item(test_session, source.id)
        await test_session.commit()

        response = await client.patch(
            f"/api/v1/signals/{item.id}/review",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestGetSignalStats:
    """Tests for GET /api/v1/signals/stats."""

    async def test_get_signal_stats_empty(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/signals/stats returns zero counts when no data exists."""
        response = await client.get("/api/v1/signals/stats", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_count"] == 0
        assert data["by_status"] == {}
        assert data["by_source"] == {}
        assert data["by_bucket"] == {}
        assert data["by_document_type"] == {}
        assert data["avg_scientific_score"] is None
        assert data["avg_strategic_score"] is None

    async def test_get_signal_stats_with_data(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/signals/stats returns correct counts with data."""
        source = await _create_source(test_session, name="PubMed")
        await _create_research_item(
            test_session,
            source.id,
            review_status="review",
            document_type="paper",
            strategic_buckets=["product_clinical"],
            scientific_strength_score=Decimal("7.5"),
            strategic_relevance_score=Decimal("8.0"),
        )
        await _create_research_item(
            test_session,
            source.id,
            review_status="relevant",
            document_type="review",
            strategic_buckets=["product_clinical", "market_expansion"],
            scientific_strength_score=Decimal("6.0"),
            strategic_relevance_score=Decimal("9.0"),
        )
        await test_session.commit()

        response = await client.get("/api/v1/signals/stats", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()

        assert data["total_count"] == 2
        assert data["by_status"]["review"] == 1
        assert data["by_status"]["relevant"] == 1
        assert data["by_source"]["PubMed"] == 2
        assert data["by_document_type"]["paper"] == 1
        assert data["by_document_type"]["review"] == 1
        assert data["by_bucket"]["product_clinical"] == 2
        assert data["by_bucket"]["market_expansion"] == 1
        assert data["avg_scientific_score"] is not None
        assert data["avg_strategic_score"] is not None

    async def test_get_signal_stats_response_shape(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Stats response has the expected schema fields."""
        response = await client.get("/api/v1/signals/stats", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        expected_fields = {
            "total_count",
            "by_status",
            "by_source",
            "by_bucket",
            "by_document_type",
            "avg_scientific_score",
            "avg_strategic_score",
        }
        assert set(data.keys()) == expected_fields
