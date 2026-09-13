"""Unit tests for the read-only post-deploy smoke check."""

import httpx
import respx

from app.jobs.post_deploy_check import run_checks

BASE = "https://api.test"
PROFILE = "software-engineering"


def _happy_routes(profile: str = PROFILE, *, database: bool = True, migrations: bool = True) -> None:
    checks = {"database": database, "migrations": migrations}
    respx.get(f"{BASE}/health").respond(200, json={"status": "ok"})
    respx.get(f"{BASE}/ready").respond(200, json={"ready": True, "checks": checks})
    respx.get(f"{BASE}/api/v1/configuration/profile").respond(200, json={"id": profile, "name": "Whatever"})


class TestRunChecks:
    """run_checks reports one result per step and never writes."""

    async def test_all_pass(self) -> None:
        with respx.mock:
            _happy_routes()
            results = await run_checks(BASE, "software-engineering")

        assert {r.name for r in results} == {"api-responds", "schema-at-head", "active-profile"}
        assert all(r.ok for r in results)

    async def test_wrong_profile_fails_only_that_step(self) -> None:
        with respx.mock:
            _happy_routes(profile="orthodontics")
            results = await run_checks(BASE, "software-engineering")

        by = {r.name: r.ok for r in results}
        assert by["active-profile"] is False
        assert by["api-responds"] is True
        assert by["schema-at-head"] is True

    async def test_schema_behind_fails(self) -> None:
        with respx.mock:
            _happy_routes(migrations=False)
            results = await run_checks(BASE, "software-engineering")

        assert {r.name: r.ok for r in results}["schema-at-head"] is False

    async def test_api_unreachable_marks_step_failed(self) -> None:
        with respx.mock:
            respx.get(f"{BASE}/health").mock(side_effect=httpx.ConnectError("down"))
            ready_checks = {"database": True, "migrations": True}
            respx.get(f"{BASE}/ready").respond(200, json={"checks": ready_checks})
            respx.get(f"{BASE}/api/v1/configuration/profile").respond(200, json={"id": PROFILE})
            results = await run_checks(BASE, "software-engineering")

        assert {r.name: r.ok for r in results}["api-responds"] is False

    async def test_frontend_branding_checked_when_requested(self) -> None:
        with respx.mock:
            _happy_routes()
            respx.get("https://front.test").respond(200, text="<title>Karajan Radar</title>")
            results = await run_checks(
                BASE,
                "software-engineering",
                frontend_url="https://front.test",
                expected_brand="Karajan Radar",
            )

        by = {r.name: r.ok for r in results}
        assert by["frontend-branding"] is True
