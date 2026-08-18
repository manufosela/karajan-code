"""Tests for digest API endpoints."""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_digest import DailyDigest
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


async def _create_digest(session: AsyncSession, **overrides: Any) -> DailyDigest:
    """Helper to create a DailyDigest record."""
    defaults = {
        "id": uuid.uuid4(),
        "digest_date": date.today(),
        "items_included": ["item-1", "item-2"],
        "delivery_channel": "teams",
        "delivery_status": "sent",
        "payload": {"html_content": "<h1>Test</h1>", "adaptive_card": {}},
        "sent_at": datetime.now(UTC),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    digest = DailyDigest(**defaults)
    session.add(digest)
    await session.flush()
    return digest


class TestListDigests:
    """Tests for GET /api/v1/digests."""

    async def test_list_digests_empty(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/digests returns empty list when no digests exist."""
        response = await client.get("/api/v1/digests", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["offset"] == 0
        assert data["limit"] == 20

    async def test_list_digests_with_data(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/digests returns digests when they exist."""
        await _create_digest(test_session)
        await _create_digest(
            test_session,
            delivery_status="pending",
            sent_at=None,
        )
        await test_session.commit()

        response = await client.get("/api/v1/digests", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    async def test_list_digests_pagination(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/digests respects offset and limit."""
        for _ in range(5):
            await _create_digest(test_session)
        await test_session.commit()

        response = await client.get("/api/v1/digests", params={"offset": 0, "limit": 2}, headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["limit"] == 2

    async def test_list_digests_filter_by_status(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/digests can filter by delivery_status."""
        await _create_digest(test_session, delivery_status="sent")
        await _create_digest(test_session, delivery_status="failed", sent_at=None)
        await test_session.commit()

        response = await client.get(
            "/api/v1/digests", params={"delivery_status": "failed"}, headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["delivery_status"] == "failed"

    async def test_list_digests_response_shape(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Each digest in the list has the expected fields."""
        await _create_digest(test_session)
        await test_session.commit()

        response = await client.get("/api/v1/digests", headers=auth_headers)

        assert response.status_code == 200
        item = response.json()["items"][0]
        expected_fields = {
            "id",
            "digest_date",
            "items_included",
            "delivery_channel",
            "delivery_status",
            "sent_at",
            "created_at",
        }
        assert expected_fields.issubset(set(item.keys()))


class TestGetDigest:
    """Tests for GET /api/v1/digests/{digest_id}."""

    async def test_get_digest_found(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/digests/{id} returns full digest detail."""
        digest = await _create_digest(test_session)
        await test_session.commit()

        response = await client.get(f"/api/v1/digests/{digest.id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(digest.id)
        assert data["delivery_channel"] == "teams"
        assert "payload" in data

    async def test_get_digest_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/digests/{id} returns 404 for non-existent digest."""
        fake_id = str(uuid.uuid4())
        response = await client.get(f"/api/v1/digests/{fake_id}", headers=auth_headers)

        assert response.status_code == 404

    async def test_get_digest_invalid_uuid(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/digests/invalid returns 422."""
        response = await client.get("/api/v1/digests/not-a-uuid", headers=auth_headers)

        assert response.status_code == 422


class TestTriggerDigest:
    """Tests for POST /api/v1/digests/trigger."""

    async def test_trigger_success(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """POST /api/v1/digests/trigger generates a digest when signals exist."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("8.5"),
            executive_summary_en="Important discovery",
        )
        await test_session.commit()

        response = await client.post(
            "/api/v1/digests/trigger",
            json={"deliver": False, "channel": "teams"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "digest_id" in data
        assert data["items_count"] >= 1
        assert data["delivery_status"] == "pending"
        assert "message" in data

    async def test_trigger_no_signals(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """POST /api/v1/digests/trigger returns 200 with empty message when no signals."""
        response = await client.post(
            "/api/v1/digests/trigger",
            json={"deliver": False, "channel": "teams"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["items_count"] == 0

    async def test_trigger_default_body(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """POST /api/v1/digests/trigger works with empty body (defaults)."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Summary",
        )
        await test_session.commit()

        response = await client.post("/api/v1/digests/trigger", json={}, headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items_count"] >= 1
