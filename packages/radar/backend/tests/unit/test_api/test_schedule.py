"""Tests for ingestion schedule endpoints."""

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.configuration import Configuration


async def _create_schedule_config(session: AsyncSession, **overrides: Any) -> Configuration:
    """Helper to create an ingestion_schedule Configuration record."""
    defaults: dict[str, Any] = {
        "id": uuid.uuid4(),
        "category": "sources",
        "key": "ingestion_schedule",
        "value": {
            "schedule_type": "daily",
            "time": "07:00",
            "timezone": "Europe/Madrid",
            "days_of_week": [],
            "day_of_month": None,
            "custom_cron": None,
        },
        "description": "Ingestion schedule configuration",
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    if "value" in overrides:
        defaults["value"] = {**defaults["value"], **overrides.pop("value")}
    defaults.update(overrides)
    config = Configuration(**defaults)
    session.add(config)
    await session.flush()
    return config


class TestGetSchedule:
    """Tests for GET /api/v1/configuration/schedule."""

    async def test_get_schedule_defaults(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns default schedule when no config exists in DB."""
        response = await client.get(
            "/api/v1/configuration/schedule",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "daily"
        assert data["time"] == "07:00"
        assert data["timezone"] == "Europe/Madrid"
        assert data["cron_expression"] == "00 07 * * *"
        assert len(data["next_runs"]) == 3
        assert data["description"] == "Every day at 07:00"
        assert "sync_status" in data

    async def test_get_schedule_from_db(
        self,
        client: AsyncClient,
        test_session: AsyncSession,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns schedule stored in DB."""
        await _create_schedule_config(
            test_session,
            value={
                "schedule_type": "weekly",
                "time": "08:00",
                "days_of_week": ["tue", "thu"],
            },
        )
        await test_session.commit()

        response = await client.get(
            "/api/v1/configuration/schedule",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "weekly"
        assert data["time"] == "08:00"
        assert data["days_of_week"] == ["tue", "thu"]
        assert data["cron_expression"] == "00 08 * * 2,4"

    async def test_get_schedule_requires_auth(self, client: AsyncClient) -> None:
        """Returns 401 without auth."""
        response = await client.get("/api/v1/configuration/schedule")
        assert response.status_code == 401


class TestUpdateSchedule:
    """Tests for PUT /api/v1/configuration/schedule."""

    async def test_update_schedule_daily(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Update to a daily schedule."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "daily",
                "time": "09:30",
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "daily"
        assert data["time"] == "09:30"
        assert data["cron_expression"] == "30 09 * * *"
        assert data["description"] == "Every day at 09:30"
        assert len(data["next_runs"]) == 3

    async def test_update_schedule_weekly(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Update to a weekly schedule."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "weekly",
                "time": "08:00",
                "days_of_week": ["mon", "wed", "fri"],
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "weekly"
        assert data["cron_expression"] == "00 08 * * 1,3,5"

    async def test_update_schedule_monthly(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Update to a monthly schedule."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "monthly",
                "time": "06:00",
                "day_of_month": 15,
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "monthly"
        assert data["cron_expression"] == "00 06 15 * *"
        assert data["day_of_month"] == 15

    async def test_update_schedule_custom(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Update to a custom cron schedule."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "custom",
                "time": "00:00",
                "custom_cron": "*/30 * * * *",
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "custom"
        assert data["cron_expression"] == "*/30 * * * *"

    async def test_update_schedule_validates_weekly_days(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns 422 if weekly has no days_of_week."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "weekly",
                "time": "08:00",
                "days_of_week": [],
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_schedule_validates_invalid_day(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns 422 for invalid day abbreviation."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "weekly",
                "time": "08:00",
                "days_of_week": ["monday"],
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_schedule_validates_monthly_day(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns 422 if monthly has no day_of_month."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "monthly",
                "time": "08:00",
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_schedule_validates_monthly_day_range(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns 422 if day_of_month is out of range."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "monthly",
                "time": "08:00",
                "day_of_month": 31,
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_schedule_validates_time(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Returns 422 for invalid time format."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "daily",
                "time": "25:00",
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_update_schedule_persists(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Updated schedule persists across GET calls."""
        await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "weekly",
                "time": "10:00",
                "days_of_week": ["sat"],
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )

        response = await client.get(
            "/api/v1/configuration/schedule",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schedule_type"] == "weekly"
        assert data["days_of_week"] == ["sat"]

    async def test_update_schedule_includes_sync_status(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Response includes sync_status field after update."""
        response = await client.put(
            "/api/v1/configuration/schedule",
            json={
                "schedule_type": "daily",
                "time": "07:00",
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        data = response.json()
        assert data["sync_status"] in ("synced", "pending_sync", "local_only")
        assert "gcloud_command" not in data


class TestRunNow:
    """Tests for POST /api/v1/configuration/schedule/run-now."""

    async def test_run_now_success(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Run-now returns success and status running."""
        response = await client.post(
            "/api/v1/configuration/schedule/run-now",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert "triggered" in data["message"].lower()

    async def test_run_now_requires_auth(self, client: AsyncClient) -> None:
        """Returns 401 without auth."""
        response = await client.post("/api/v1/configuration/schedule/run-now")
        assert response.status_code == 401
