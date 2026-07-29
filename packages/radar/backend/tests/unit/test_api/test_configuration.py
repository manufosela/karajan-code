"""Tests for configuration endpoints."""

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.configuration import Configuration


async def _create_config(session: AsyncSession, **overrides: Any) -> Configuration:
    """Helper to create a Configuration record in the test DB."""
    defaults = {
        "id": uuid.uuid4(),
        "category": "general",
        "key": "test_key",
        "value": {"setting": "default_value"},
        "description": "A test configuration entry",
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    config = Configuration(**defaults)
    session.add(config)
    await session.flush()
    return config


class TestListConfiguration:
    """Tests for GET /api/v1/configuration."""

    async def test_list_configuration_empty(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/configuration returns empty list when no configs exist."""
        response = await client.get("/api/v1/configuration", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    async def test_list_configuration_returns_all(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/configuration returns all configuration entries."""
        await _create_config(test_session, category="scoring", key="threshold")
        await _create_config(test_session, category="delivery", key="enabled")
        await test_session.commit()

        response = await client.get("/api/v1/configuration", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    async def test_list_configuration_by_category(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """Filter by category returns only matching entries."""
        await _create_config(test_session, category="scoring", key="threshold")
        await _create_config(test_session, category="scoring", key="max_score")
        await _create_config(test_session, category="delivery", key="enabled")
        await test_session.commit()

        response = await client.get("/api/v1/configuration", params={"category": "scoring"}, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        for item in data:
            assert item["category"] == "scoring"

    async def test_list_configuration_by_category_no_match(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Filter by non-existent category returns empty list."""
        await _create_config(test_session, category="scoring", key="threshold")
        await test_session.commit()

        response = await client.get("/api/v1/configuration", params={"category": "nonexistent"}, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 0

    async def test_list_configuration_ordered(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """Configuration entries are ordered by category then key."""
        await _create_config(test_session, category="thematic", key="a_key")
        await _create_config(test_session, category="general", key="z_key")
        await _create_config(test_session, category="general", key="a_key")
        await test_session.commit()

        response = await client.get("/api/v1/configuration", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        # Should be ordered: general/a_key, general/z_key, thematic/a_key
        assert data[0]["category"] == "general"
        assert data[0]["key"] == "a_key"
        assert data[1]["category"] == "general"
        assert data[1]["key"] == "z_key"
        assert data[2]["category"] == "thematic"

    async def test_list_configuration_response_shape(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """Each configuration entry has the expected fields."""
        await _create_config(
            test_session,
            category="general",
            key="app_mode",
            value={"mode": "production"},
            description="Application mode",
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        item = data[0]
        assert "id" in item
        assert item["category"] == "general"
        assert item["key"] == "app_mode"
        assert item["value"] == {"mode": "production"}
        assert item["description"] == "Application mode"
        assert "created_at" in item
        assert "updated_at" in item


class TestGetConfiguration:
    """Tests for GET /api/v1/configuration/{category}/{key}."""

    async def test_get_configuration(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/configuration/{category}/{key} returns the matching entry."""
        await _create_config(
            test_session,
            category="scoring",
            key="min_relevance",
            value={"threshold": 5.0},
            description="Minimum relevance score",
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration/scoring/min_relevance", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "scoring"
        assert data["key"] == "min_relevance"
        assert data["value"] == {"threshold": 5.0}
        assert data["description"] == "Minimum relevance score"

    async def test_get_configuration_not_found(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/configuration/{category}/{key} returns 404 for non-existent entry."""
        response = await client.get("/api/v1/configuration/nonexistent/missing_key", headers=auth_headers)

        assert response.status_code == 404
        data = response.json()
        # The global 404 handler returns ErrorResponse format
        assert "error" in data
        assert data["error"]["code"] == "NOT_FOUND"

    async def test_get_configuration_wrong_key(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """Returns 404 when category exists but key does not."""
        await _create_config(test_session, category="scoring", key="threshold")
        await test_session.commit()

        response = await client.get("/api/v1/configuration/scoring/wrong_key", headers=auth_headers)
        assert response.status_code == 404

    async def test_get_configuration_wrong_category(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """Returns 404 when key exists but in different category."""
        await _create_config(test_session, category="scoring", key="threshold")
        await test_session.commit()

        response = await client.get("/api/v1/configuration/wrong_category/threshold", headers=auth_headers)
        assert response.status_code == 404


class TestUpdateConfiguration:
    """Tests for PUT /api/v1/configuration/{category}/{key}."""

    async def test_update_configuration_existing(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """PUT updates an existing configuration entry."""
        await _create_config(
            test_session,
            category="scoring",
            key="threshold",
            value={"min": 3},
            description="Old description",
        )
        await test_session.commit()

        response = await client.put(
            "/api/v1/configuration/scoring/threshold",
            json={"value": {"min": 7}, "description": "Updated description"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "scoring"
        assert data["key"] == "threshold"
        assert data["value"] == {"min": 7}
        assert data["description"] == "Updated description"

    async def test_update_configuration_creates_new(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT creates a new configuration entry if it does not exist."""
        response = await client.put(
            "/api/v1/configuration/sources/new_key",
            json={"value": {"enabled": True}, "description": "Brand new config"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "sources"
        assert data["key"] == "new_key"
        assert data["value"] == {"enabled": True}
        assert data["description"] == "Brand new config"

    async def test_update_configuration_value_only(self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str]) -> None:
        """PUT with only value (no description) updates value and preserves description."""
        await _create_config(
            test_session,
            category="scoring",
            key="max_score",
            value={"max": 10},
            description="Maximum score",
        )
        await test_session.commit()

        response = await client.put(
            "/api/v1/configuration/scoring/max_score",
            json={"value": {"max": 20}},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["value"] == {"max": 20}
        # Description should be preserved since body.description is None
        assert data["description"] == "Maximum score"

    async def test_update_configuration_missing_value(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT without required 'value' field returns 422."""
        response = await client.put(
            "/api/v1/configuration/scoring/threshold",
            json={"description": "Missing value field"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_configuration_roundtrip(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Create via PUT, then verify via GET."""
        # Create
        put_response = await client.put(
            "/api/v1/configuration/llm/test_key",
            json={"value": {"data": "test_value"}, "description": "Roundtrip test"},
            headers=auth_headers,
        )
        assert put_response.status_code == 200

        # Verify
        get_response = await client.get("/api/v1/configuration/llm/test_key", headers=auth_headers)
        assert get_response.status_code == 200
        data = get_response.json()
        assert data["value"] == {"data": "test_value"}
        assert data["description"] == "Roundtrip test"
