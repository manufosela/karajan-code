"""Tests for analytics endpoints."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingestion_run import IngestionRun
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


async def _create_ingestion_run(
    session: AsyncSession, source_id: uuid.UUID, **overrides: Any
) -> IngestionRun:
    """Helper to create an IngestionRun record in the test DB."""
    defaults = {
        "id": uuid.uuid4(),
        "source_id": source_id,
        "started_at": datetime.now(UTC),
        "status": "completed",
        "items_fetched": 10,
        "items_new": 5,
        "items_duplicate": 3,
        "items_processed": 8,
        "errors": [],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    run = IngestionRun(**defaults)
    session.add(run)
    await session.flush()
    return run


class TestTrendsEndpoint:
    """Tests for GET /api/v1/analytics/trends."""

    async def test_trends_empty_db(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/analytics/trends returns empty response when no data exists."""
        response = await client.get("/api/v1/analytics/trends", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "30d"
        assert data["total"] == 0
        assert data["by_source"] == []

    async def test_trends_returns_data(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/analytics/trends returns signals grouped by source and day."""
        source = await _create_source(test_session, name="PubMed")
        now = datetime.now(UTC)
        await _create_research_item(
            test_session,
            source.id,
            original_title="Recent article",
            created_at=now - timedelta(days=1),
        )
        await _create_research_item(
            test_session,
            source.id,
            original_title="Another recent article",
            created_at=now - timedelta(days=1),
        )
        await _create_research_item(
            test_session,
            source.id,
            original_title="Older article",
            created_at=now - timedelta(days=5),
        )
        await test_session.commit()

        response = await client.get("/api/v1/analytics/trends", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "30d"
        assert data["total"] == 3
        assert len(data["by_source"]) == 1
        assert data["by_source"][0]["source_name"] == "PubMed"
        # Should have 2 different days
        assert len(data["by_source"][0]["data"]) == 2

    async def test_trends_with_period_param(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/analytics/trends?period=7d respects the period filter."""
        source = await _create_source(test_session, name="ArXiv")
        now = datetime.now(UTC)
        # Item within 7 days
        await _create_research_item(
            test_session,
            source.id,
            original_title="Recent",
            created_at=now - timedelta(days=3),
        )
        # Item outside 7 days but within 30 days
        await _create_research_item(
            test_session,
            source.id,
            original_title="Older",
            created_at=now - timedelta(days=15),
        )
        await test_session.commit()

        response_7d = await client.get(
            "/api/v1/analytics/trends", params={"period": "7d"}, headers=auth_headers
        )
        assert response_7d.status_code == 200
        data_7d = response_7d.json()
        assert data_7d["period"] == "7d"
        assert data_7d["total"] == 1

        response_30d = await client.get(
            "/api/v1/analytics/trends", params={"period": "30d"}, headers=auth_headers
        )
        assert response_30d.status_code == 200
        data_30d = response_30d.json()
        assert data_30d["total"] == 2

    async def test_trends_invalid_period(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/analytics/trends?period=invalid returns 422."""
        response = await client.get(
            "/api/v1/analytics/trends", params={"period": "invalid"}, headers=auth_headers
        )
        assert response.status_code == 422


class TestScoresEndpoint:
    """Tests for GET /api/v1/analytics/scores."""

    async def test_scores_empty_db(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/analytics/scores returns empty distributions when no data exists."""
        response = await client.get("/api/v1/analytics/scores", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["scientific"]) == 10  # 10 buckets always present
        assert len(data["strategic"]) == 10
        assert data["avg_scientific"] is None
        assert data["avg_strategic"] is None
        assert data["by_bucket"] == {}
        assert data["by_hype_risk"] == {}
        assert data["by_recommended_action"] == {}
        # All counts should be 0
        for bucket in data["scientific"]:
            assert bucket["count"] == 0

    async def test_scores_returns_distributions(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/analytics/scores returns correct histograms and aggregations."""
        source = await _create_source(test_session, name="PubMed")
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("7.50"),
            strategic_relevance_score=Decimal("8.00"),
            hype_risk="low",
            recommended_action="monitor",
            strategic_buckets=["product_clinical"],
        )
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("3.20"),
            strategic_relevance_score=Decimal("5.50"),
            hype_risk="high",
            recommended_action="investigate",
            strategic_buckets=["product_clinical", "market_expansion"],
        )
        await _create_research_item(
            test_session,
            source.id,
            scientific_strength_score=Decimal("7.80"),
            strategic_relevance_score=Decimal("9.10"),
            hype_risk="low",
            recommended_action="monitor",
            strategic_buckets=["market_expansion"],
        )
        await test_session.commit()

        response = await client.get("/api/v1/analytics/scores", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()

        # Check averages are present and reasonable
        assert data["avg_scientific"] is not None
        assert data["avg_strategic"] is not None
        assert 0 <= data["avg_scientific"] <= 10
        assert 0 <= data["avg_strategic"] <= 10

        # Check scientific histogram: 2 items in 7-8 bucket, 1 in 3-4
        sci_map = {b["bucket"]: b["count"] for b in data["scientific"]}
        assert sci_map["7-8"] == 2
        assert sci_map["3-4"] == 1

        # Check by_hype_risk
        assert data["by_hype_risk"]["low"] == 2
        assert data["by_hype_risk"]["high"] == 1

        # Check by_recommended_action
        assert data["by_recommended_action"]["monitor"] == 2
        assert data["by_recommended_action"]["investigate"] == 1

        # Check by_bucket (strategic buckets)
        assert data["by_bucket"]["product_clinical"] == 2
        assert data["by_bucket"]["market_expansion"] == 2


class TestIngestionEndpoint:
    """Tests for GET /api/v1/analytics/ingestion."""

    async def test_ingestion_empty_db(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/analytics/ingestion returns empty response when no data exists."""
        response = await client.get("/api/v1/analytics/ingestion", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["recent_runs"] == []
        assert data["sources_health"] == []
        assert data["total_processed_24h"] == 0
        assert data["total_errors_24h"] == 0

    async def test_ingestion_returns_recent_runs(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """GET /api/v1/analytics/ingestion returns recent runs with source names."""
        source = await _create_source(test_session, name="ClinicalTrials")
        now = datetime.now(UTC)
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=now - timedelta(hours=2),
            completed_at=now - timedelta(hours=1),
            status="completed",
            items_fetched=50,
            items_new=30,
            items_duplicate=15,
            items_processed=45,
        )
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=now - timedelta(hours=5),
            completed_at=now - timedelta(hours=4),
            status="failed",
            items_fetched=0,
            items_new=0,
            items_duplicate=0,
            items_processed=0,
        )
        await test_session.commit()

        response = await client.get("/api/v1/analytics/ingestion", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["recent_runs"]) == 2
        # Most recent first
        assert data["recent_runs"][0]["status"] == "completed"
        assert data["recent_runs"][0]["source_name"] == "ClinicalTrials"
        assert data["recent_runs"][0]["items_fetched"] == 50
        assert data["recent_runs"][0]["duration_seconds"] is not None
        assert data["recent_runs"][0]["duration_seconds"] > 0

        # Source health
        assert len(data["sources_health"]) == 1
        health = data["sources_health"][0]
        assert health["source_name"] == "ClinicalTrials"
        assert health["runs_7d"] == 2
        assert health["error_rate"] == 50.0  # 1 out of 2 failed

        # 24h totals
        assert data["total_processed_24h"] == 45  # only completed run counts
        assert data["total_errors_24h"] == 1

    async def test_ingestion_response_shape(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Ingestion response has the expected schema fields."""
        response = await client.get("/api/v1/analytics/ingestion", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        expected_fields = {
            "recent_runs",
            "sources_health",
            "total_processed_24h",
            "total_errors_24h",
        }
        assert set(data.keys()) == expected_fields


class TestCostsEndpoint:
    """Tests for GET /api/v1/analytics/costs."""

    async def test_costs_requires_auth(self, client: AsyncClient) -> None:
        """GET /api/v1/analytics/costs returns 401 without authentication."""
        response = await client.get("/api/v1/analytics/costs")
        assert response.status_code == 401

    async def test_costs_empty_db(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/analytics/costs returns estimates even with no usage data."""
        response = await client.get("/api/v1/analytics/costs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "current_month"
        assert data["currency"] == "USD"
        assert data["signals_processed"] == 0
        assert data["ingestion_runs"] == 0
        assert isinstance(data["line_items"], list)
        assert len(data["line_items"]) == 5
        assert data["total_estimated"] >= 0
        assert "last_updated" in data

    async def test_costs_response_shape(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Cost estimate response has the expected schema fields."""
        response = await client.get("/api/v1/analytics/costs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        expected_fields = {
            "period",
            "line_items",
            "total_estimated",
            "currency",
            "signals_processed",
            "ingestion_runs",
            "last_updated",
        }
        assert set(data.keys()) == expected_fields

    async def test_costs_line_items_structure(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Each cost line item has label, amount, and note fields."""
        response = await client.get("/api/v1/analytics/costs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        for item in data["line_items"]:
            assert "label" in item
            assert "amount" in item
            assert "note" in item
            assert isinstance(item["amount"], (int, float))
            assert item["amount"] >= 0

    async def test_costs_with_usage_data(
        self, client: AsyncClient, auth_headers: dict[str, str], test_session: AsyncSession
    ) -> None:
        """GET /api/v1/analytics/costs reflects ingestion run data in estimates."""
        source = await _create_source(test_session, name="PubMed")
        now = datetime.now(UTC)

        # Create ingestion runs this month
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=now - timedelta(hours=2),
            completed_at=now - timedelta(hours=1),
            status="completed",
            items_fetched=100,
            items_new=80,
            items_duplicate=20,
            items_processed=80,
        )
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=now - timedelta(hours=5),
            completed_at=now - timedelta(hours=4),
            status="completed",
            items_fetched=50,
            items_new=30,
            items_duplicate=10,
            items_processed=40,
        )
        await test_session.commit()

        response = await client.get("/api/v1/analytics/costs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["ingestion_runs"] == 2
        assert data["signals_processed"] >= 120  # 80 + 40
        # Total should be higher than with zero usage
        assert data["total_estimated"] > 0

        # Cloud Run Backend cost should be > 0 with runs
        cloud_run_backend = next((item for item in data["line_items"] if "Backend" in item["label"]), None)
        assert cloud_run_backend is not None
        assert cloud_run_backend["amount"] > 0

        # OpenAI cost should be > 0 with processed signals
        openai_item = next((item for item in data["line_items"] if "OpenAI" in item["label"]), None)
        assert openai_item is not None
        assert openai_item["amount"] > 0

    async def test_costs_fixed_items_always_present(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Fixed-cost items (Cloud SQL, Frontend) have non-zero amounts even with no usage."""
        response = await client.get("/api/v1/analytics/costs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()

        cloud_sql = next((item for item in data["line_items"] if "Cloud SQL" in item["label"]), None)
        assert cloud_sql is not None
        assert cloud_sql["amount"] > 0

        frontend = next((item for item in data["line_items"] if "Frontend" in item["label"]), None)
        assert frontend is not None
        assert frontend["amount"] > 0
