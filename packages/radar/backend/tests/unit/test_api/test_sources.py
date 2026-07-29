"""Tests for source management panel API endpoints.

Covers: list sources, source detail with last ingestion stats,
update source config (enabled, query_terms, max_results),
and list ingestion runs for a source.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingestion_run import IngestionRun
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


async def _create_ingestion_run(
    session: AsyncSession, source_id: uuid.UUID, **overrides: Any
) -> IngestionRun:
    """Helper to create an IngestionRun record."""
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


# =============================================================================
# List sources tests
# =============================================================================
class TestListSources:
    """Tests for GET /api/v1/sources."""

    async def test_empty_list(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns empty list when no sources exist."""
        resp = await client.get("/api/v1/sources", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_all_sources(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Returns all sources."""
        await _create_source(test_session, name="PubMed", priority=1)
        await _create_source(test_session, name="ArXiv", priority=2)
        await test_session.commit()

        resp = await client.get("/api/v1/sources", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    async def test_ordered_by_priority_then_name(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Sources are ordered by priority ASC, then name ASC."""
        await _create_source(test_session, name="Zebra", priority=2)
        await _create_source(test_session, name="Alpha", priority=2)
        await _create_source(test_session, name="PubMed", priority=1)
        await test_session.commit()

        resp = await client.get("/api/v1/sources", headers=auth_headers)
        data = resp.json()
        names = [s["name"] for s in data]
        assert names == ["PubMed", "Alpha", "Zebra"]

    async def test_response_contains_expected_fields(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Each source in list has the expected response fields."""
        await _create_source(test_session, name="PubMed", enabled=True)
        await test_session.commit()

        resp = await client.get("/api/v1/sources", headers=auth_headers)
        source = resp.json()[0]
        expected_keys = {
            "id",
            "name",
            "source_type",
            "category",
            "priority",
            "enabled",
            "config",
            "base_url",
            "last_fetched_at",
            "created_at",
            "updated_at",
        }
        assert expected_keys <= set(source.keys())


# =============================================================================
# Source detail tests
# =============================================================================
class TestGetSourceDetail:
    """Tests for GET /api/v1/sources/{id}."""

    async def test_found_with_no_runs(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Returns source detail with null last_run stats when no runs exist."""
        source = await _create_source(test_session, name="PubMed")
        await test_session.commit()

        resp = await client.get(f"/api/v1/sources/{source.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(source.id)
        assert data["name"] == "PubMed"
        assert data["last_run_status"] is None
        assert data["last_run_at"] is None
        assert data["items_fetched_last_run"] is None
        assert data["total_runs"] == 0

    async def test_found_with_runs(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Returns source detail with last_run stats from the most recent run."""
        source = await _create_source(test_session, name="PubMed")
        # Older run
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=datetime(2025, 1, 1, tzinfo=UTC),
            status="completed",
            items_fetched=5,
        )
        # Most recent run
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=datetime(2025, 6, 1, tzinfo=UTC),
            status="failed",
            items_fetched=20,
        )
        await test_session.commit()

        resp = await client.get(f"/api/v1/sources/{source.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_run_status"] == "failed"
        assert data["items_fetched_last_run"] == 20
        assert data["total_runs"] == 2

    async def test_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 404 for non-existent source."""
        fake_id = str(uuid.uuid4())
        resp = await client.get(f"/api/v1/sources/{fake_id}", headers=auth_headers)
        assert resp.status_code == 404

    async def test_invalid_uuid(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 422 for invalid UUID format."""
        resp = await client.get("/api/v1/sources/not-a-uuid", headers=auth_headers)
        assert resp.status_code == 422


# =============================================================================
# Update source tests
# =============================================================================
class TestUpdateSource:
    """Tests for PATCH /api/v1/sources/{id}."""

    async def test_enable_disable(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Can toggle enabled flag."""
        source = await _create_source(test_session, enabled=True)
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/sources/{source.id}",
            json={"enabled": False},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    async def test_update_query_terms(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Can update query_terms via config merge."""
        source = await _create_source(
            test_session,
            config={"existing_key": "keep_me"},
        )
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/sources/{source.id}",
            json={"query_terms": ["orthodontics", "aligners"]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        config = resp.json()["config"]
        assert config["query_terms"] == ["orthodontics", "aligners"]
        assert config["existing_key"] == "keep_me"

    async def test_update_max_results(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Can update max_results via config merge."""
        source = await _create_source(test_session, config={})
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/sources/{source.id}",
            json={"max_results": 50},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["config"]["max_results"] == 50

    async def test_partial_update_preserves_other_fields(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Partial update does not change unspecified fields."""
        source = await _create_source(test_session, name="PubMed", priority=3, enabled=True)
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/sources/{source.id}",
            json={"priority": 5},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["priority"] == 5
        assert data["name"] == "PubMed"
        assert data["enabled"] is True

    async def test_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 404 for non-existent source."""
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/sources/{fake_id}",
            json={"enabled": False},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_invalid_priority(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Rejects priority out of range."""
        source = await _create_source(test_session)
        await test_session.commit()

        resp = await client.patch(
            f"/api/v1/sources/{source.id}",
            json={"priority": 99},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# =============================================================================
# List ingestion runs tests
# =============================================================================
class TestListSourceRuns:
    """Tests for GET /api/v1/sources/{id}/runs."""

    async def test_empty_runs(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Returns empty list when source has no runs."""
        source = await _create_source(test_session)
        await test_session.commit()

        resp = await client.get(f"/api/v1/sources/{source.id}/runs", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_runs_ordered_desc(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Returns runs ordered by started_at descending."""
        source = await _create_source(test_session)
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=datetime(2025, 1, 1, tzinfo=UTC),
            status="completed",
        )
        await _create_ingestion_run(
            test_session,
            source.id,
            started_at=datetime(2025, 6, 1, tzinfo=UTC),
            status="failed",
        )
        await test_session.commit()

        resp = await client.get(f"/api/v1/sources/{source.id}/runs", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Most recent first
        assert data[0]["status"] == "failed"
        assert data[1]["status"] == "completed"

    async def test_run_response_fields(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Each run has the expected response fields."""
        source = await _create_source(test_session)
        await _create_ingestion_run(
            test_session,
            source.id,
            items_fetched=10,
            items_new=5,
            items_duplicate=3,
            items_processed=8,
        )
        await test_session.commit()

        resp = await client.get(f"/api/v1/sources/{source.id}/runs", headers=auth_headers)
        run = resp.json()[0]
        expected_keys = {
            "id",
            "source_id",
            "started_at",
            "completed_at",
            "status",
            "items_fetched",
            "items_new",
            "items_duplicate",
            "items_processed",
            "errors",
        }
        assert expected_keys <= set(run.keys())
        assert run["items_fetched"] == 10
        assert run["items_new"] == 5

    async def test_source_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 404 when source doesn't exist."""
        fake_id = str(uuid.uuid4())
        resp = await client.get(f"/api/v1/sources/{fake_id}/runs", headers=auth_headers)
        assert resp.status_code == 404
