"""Tests for configuration domain-specific endpoints (topics, weights, delivery)."""

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


class TestGetConfigurationByCategory:
    """Tests for GET /api/v1/configuration/{category}."""

    async def test_get_category_returns_matching_entries(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """GET /api/v1/configuration/{category} returns all configs for that category."""
        await _create_config(test_session, category="scoring", key="threshold", value={"min": 3})
        await _create_config(test_session, category="scoring", key="max_score", value={"max": 10})
        await _create_config(test_session, category="delivery", key="enabled", value={"on": True})
        await test_session.commit()

        response = await client.get("/api/v1/configuration/scoring", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2
        for item in data:
            assert item["category"] == "scoring"

    async def test_get_category_empty_result(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """GET /api/v1/configuration/{category} returns empty list for category with no entries."""
        await _create_config(test_session, category="scoring", key="threshold")
        await test_session.commit()

        # Use 'llm' category (no static route conflict, unlike 'delivery')
        response = await client.get("/api/v1/configuration/llm", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    async def test_get_category_invalid_returns_422(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """GET /api/v1/configuration/{category} returns 422 for invalid category."""
        response = await client.get("/api/v1/configuration/invalid_category", headers=auth_headers)
        assert response.status_code == 422

    async def test_get_category_all_valid_categories_without_static_routes(
        self, client: AsyncClient, auth_headers: dict[str, str],
    ) -> None:
        """Valid categories without static route conflicts are accepted."""
        # 'delivery' is handled by its own static route, so excluded here
        for category in ("thematic", "scoring", "llm", "general", "sources"):
            response = await client.get(f"/api/v1/configuration/{category}", headers=auth_headers)
            assert response.status_code == 200

    async def test_get_category_ordered_by_key(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Results are ordered by key within the category."""
        await _create_config(test_session, category="scoring", key="z_key", value={"z": 1})
        await _create_config(test_session, category="scoring", key="a_key", value={"a": 1})
        await test_session.commit()

        response = await client.get("/api/v1/configuration/scoring", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["key"] == "a_key"
        assert data[1]["key"] == "z_key"


class TestGetThematicTopics:
    """Tests for GET /api/v1/configuration/thematic/topics."""

    async def test_get_topics_returns_taxonomy(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """GET /api/v1/configuration/thematic/topics returns topic taxonomy."""
        await _create_config(
            test_session,
            category="thematic",
            key="orthodontics_keywords",
            value={"keywords": ["aligners", "brackets", "malocclusion"]},
        )
        await _create_config(
            test_session,
            category="thematic",
            key="strategic_buckets",
            value={"buckets": ["product_clinical", "market_intelligence", "regulatory"]},
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration/thematic/topics", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "orthodontics_keywords" in data
        assert "strategic_buckets" in data
        assert data["orthodontics_keywords"] == {"keywords": ["aligners", "brackets", "malocclusion"]}
        assert data["strategic_buckets"] == {"buckets": ["product_clinical", "market_intelligence", "regulatory"]}

    async def test_get_topics_partial_data(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Returns available topic data even if only one key exists."""
        await _create_config(
            test_session,
            category="thematic",
            key="orthodontics_keywords",
            value={"keywords": ["aligners"]},
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration/thematic/topics", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "orthodontics_keywords" in data
        assert data["orthodontics_keywords"] == {"keywords": ["aligners"]}

    async def test_get_topics_no_data_returns_404(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 404 when no thematic topic config exists."""
        response = await client.get("/api/v1/configuration/thematic/topics", headers=auth_headers)
        assert response.status_code == 404

    async def test_topics_route_not_shadowed_by_category_key(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Static /thematic/topics route is not intercepted by /{category}/{key}."""
        await _create_config(
            test_session,
            category="thematic",
            key="orthodontics_keywords",
            value={"keywords": ["aligners"]},
        )
        await test_session.commit()

        # This should hit the topics endpoint, not /{category}/{key}
        response = await client.get("/api/v1/configuration/thematic/topics", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # The topics endpoint returns a merged object, not a single ConfigResponse
        assert "orthodontics_keywords" in data


class TestUpdateScoringWeights:
    """Tests for PUT /api/v1/configuration/scoring/weights."""

    async def test_update_weights_creates_new(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT /api/v1/configuration/scoring/weights creates weights config if not exists."""
        payload = {
            "weights": {
                "novelty": 0.25,
                "relevance": 0.30,
                "impact": 0.25,
                "credibility": 0.20,
            },
        }
        response = await client.put("/api/v1/configuration/scoring/weights", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "scoring"
        assert data["key"] == "weights"
        assert data["value"]["weights"] == payload["weights"]

    async def test_update_weights_updates_existing(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """PUT updates existing scoring weights entry."""
        await _create_config(
            test_session,
            category="scoring",
            key="weights",
            value={"weights": {"novelty": 0.5, "relevance": 0.5, "impact": 0.0, "credibility": 0.0}},
        )
        await test_session.commit()

        payload = {
            "weights": {
                "novelty": 0.25,
                "relevance": 0.25,
                "impact": 0.25,
                "credibility": 0.25,
            },
        }
        response = await client.put("/api/v1/configuration/scoring/weights", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["value"]["weights"] == payload["weights"]

    async def test_update_weights_rejects_non_numeric(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT rejects weights with non-numeric values."""
        payload = {
            "weights": {
                "novelty": "high",
                "relevance": 0.30,
                "impact": 0.25,
                "credibility": 0.20,
            },
        }
        response = await client.put("/api/v1/configuration/scoring/weights", json=payload, headers=auth_headers)
        assert response.status_code == 422

    async def test_update_weights_rejects_missing_keys(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT rejects weights with missing required keys."""
        payload = {
            "weights": {
                "novelty": 0.50,
                "relevance": 0.50,
                # missing impact and credibility
            },
        }
        response = await client.put("/api/v1/configuration/scoring/weights", json=payload, headers=auth_headers)
        assert response.status_code == 422

    async def test_update_weights_rejects_empty_body(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT rejects empty body."""
        response = await client.put("/api/v1/configuration/scoring/weights", json={}, headers=auth_headers)
        assert response.status_code == 422

    async def test_weights_route_not_shadowed(
        self, client: AsyncClient, auth_headers: dict[str, str],
    ) -> None:
        """Static /scoring/weights route is not intercepted by PUT /{category}/{key}."""
        payload = {
            "weights": {
                "novelty": 0.25,
                "relevance": 0.25,
                "impact": 0.25,
                "credibility": 0.25,
            },
        }
        response = await client.put("/api/v1/configuration/scoring/weights", json=payload, headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # Should be stored with domain-validated schema, not generic ConfigUpdate
        assert "weights" in data["value"]


class TestUpdateConfigurationCategoryValidation:
    """Tests for PUT /api/v1/configuration/{category}/{key} category validation (R-1)."""

    async def test_update_invalid_category_returns_422(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT with invalid category returns 422 instead of DB 500."""
        response = await client.put(
            "/api/v1/configuration/invalid_category/some_key",
            json={"value": {"data": "test"}, "description": "Should be rejected"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_valid_category_accepted(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """PUT with valid category is accepted."""
        response = await client.put(
            "/api/v1/configuration/general/some_key",
            json={"value": {"data": "test"}, "description": "Valid category"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "general"
        assert data["key"] == "some_key"


class TestGetDeliverySettings:
    """Tests for GET /api/v1/configuration/delivery."""

    async def test_get_delivery_returns_settings(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """GET /api/v1/configuration/delivery returns aggregated delivery settings."""
        await _create_config(
            test_session,
            category="delivery",
            key="digest_frequency",
            value={"frequency": "weekly", "day": "monday"},
        )
        await _create_config(
            test_session,
            category="delivery",
            key="channels",
            value={"email": True, "slack": True, "webhook": False},
        )
        await _create_config(
            test_session,
            category="delivery",
            key="recipients",
            value={"emails": ["team@example.com"], "slack_channels": ["#radar"]},
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration/delivery", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "digest_frequency" in data
        assert "channels" in data
        assert "recipients" in data
        assert data["digest_frequency"] == {"frequency": "weekly", "day": "monday"}

    async def test_get_delivery_partial_data(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Returns available delivery data even if only some keys exist."""
        await _create_config(
            test_session,
            category="delivery",
            key="digest_frequency",
            value={"frequency": "daily"},
        )
        await test_session.commit()

        response = await client.get("/api/v1/configuration/delivery", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "digest_frequency" in data

    async def test_get_delivery_no_data_returns_404(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """Returns 404 when no delivery config exists."""
        response = await client.get("/api/v1/configuration/delivery", headers=auth_headers)
        assert response.status_code == 404

    async def test_delivery_route_not_shadowed_by_category(
        self, client: AsyncClient, test_session: AsyncSession, auth_headers: dict[str, str],
    ) -> None:
        """Static /delivery route is not intercepted by GET /{category}."""
        await _create_config(
            test_session,
            category="delivery",
            key="channels",
            value={"email": True},
        )
        await test_session.commit()

        # This should hit the delivery endpoint, not /{category}
        response = await client.get("/api/v1/configuration/delivery", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        # The delivery endpoint returns an aggregated object, not a list of ConfigResponse
        assert isinstance(data, dict)
        assert "channels" in data
