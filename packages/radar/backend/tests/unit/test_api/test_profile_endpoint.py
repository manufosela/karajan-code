"""Tests for the active Radar Profile endpoint.

The frontend labels every theme, bucket and horizon from this response, so it
is the contract that keeps domain vocabulary out of the components.
"""

from __future__ import annotations

import pytest

from app.profiles.active import get_active_profile


@pytest.fixture
def profile():
    return get_active_profile()


class TestGetActiveProfile:
    async def test_requires_authentication(self, client) -> None:
        response = await client.get("/api/v1/configuration/profile")

        assert response.status_code == 401

    async def test_returns_the_active_profile(self, client, auth_headers) -> None:
        response = await client.get("/api/v1/configuration/profile", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["id"] == "orthodontics"

    async def test_is_not_captured_by_the_category_route(self, client, auth_headers) -> None:
        """/{category} would otherwise swallow /profile as a category name."""
        response = await client.get("/api/v1/configuration/profile", headers=auth_headers)

        assert response.status_code == 200
        assert "taxonomy" in response.json()

    async def test_exposes_the_full_taxonomy(self, client, auth_headers, profile) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        returned = {theme["id"] for theme in body["taxonomy"]["themes"]}

        assert returned == set(profile.taxonomy.theme_ids)

    async def test_every_term_carries_a_label_and_description(self, client, auth_headers) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        for theme in body["taxonomy"]["themes"]:
            assert theme["label"]
            assert theme["description"]

    async def test_exposes_buckets_and_horizons(self, client, auth_headers, profile) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        buckets = {b["id"] for b in body["taxonomy"]["strategic_buckets"]}
        horizons = {h["id"] for h in body["taxonomy"]["time_horizons"]}

        assert buckets == set(profile.taxonomy.bucket_ids)
        assert horizons == set(profile.taxonomy.time_horizon_ids)

    async def test_exposes_the_scoring_vocabulary(self, client, auth_headers, profile) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        levels = {entry["id"] for entry in body["vocabulary"]["impact_levels"]}

        assert levels == set(profile.vocabulary.impact_level_ids)

    async def test_keeps_the_two_action_vocabularies_separate(self, client, auth_headers) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        impact = {a["id"] for a in body["vocabulary"]["impact_recommended_actions"]}
        scoring = {a["id"] for a in body["vocabulary"]["scoring_recommended_actions"]}

        assert impact != scoring

    async def test_exposes_branding(self, client, auth_headers, profile) -> None:
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        assert body["branding"]["app_name"] == profile.branding.app_name
        assert body["branding"]["organization_name"] == profile.organization.name

    async def test_does_not_leak_operational_configuration(self, client, auth_headers) -> None:
        """Prompts, source queries and LLM settings never reach the browser."""
        body = (await client.get("/api/v1/configuration/profile", headers=auth_headers)).json()

        assert "prompts" not in body
        assert "sources" not in body
        assert "llm" not in body
