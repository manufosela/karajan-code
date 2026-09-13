"""Read-only post-deploy smoke check for a Radar instance (KRD-TSK-0020).

Against the deployed URLs, without writing: API responds, schema at head, and
the active profile is the one this instance declares. Names the broken link and
exits non-zero if any step fails.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass

import httpx


@dataclass
class StepResult:
    """One smoke step: what it checked, whether it held, and a human detail."""

    name: str
    ok: bool
    detail: str


async def _get(client: httpx.AsyncClient, url: str, headers: dict[str, str]) -> httpx.Response:
    response = await client.get(url, headers=headers)  # raise on non-2xx: a step never passes on error
    response.raise_for_status()
    return response


async def run_checks(
    base_url: str,
    expected_profile: str,
    *,
    frontend_url: str | None = None,
    expected_brand: str | None = None,
    token: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> list[StepResult]:
    """Run the read-only checks and return one StepResult per step."""
    base_url = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=10.0)
    results: list[StepResult] = []

    try:
        try:
            await _get(client, f"{base_url}/health", headers)
            results.append(StepResult("api-responds", True, "GET /health -> 2xx"))
        except Exception as error:
            results.append(StepResult("api-responds", False, f"api-responds: {error}"))

        try:
            checks = (await _get(client, f"{base_url}/ready", headers)).json().get("checks", {})
            at_head = checks.get("migrations") is True and checks.get("database") is True
            detail = f"database={checks.get('database')}, migrations={checks.get('migrations')}"
            results.append(StepResult("schema-at-head", at_head, detail))
        except Exception as error:
            results.append(StepResult("schema-at-head", False, f"schema-at-head: {error}"))

        try:
            profile = await _get(client, f"{base_url}/api/v1/configuration/profile", headers)
            actual = profile.json().get("id")
            detail = f"expected '{expected_profile}', got '{actual}'"
            results.append(StepResult("active-profile", actual == expected_profile, detail))
        except Exception as error:
            results.append(StepResult("active-profile", False, f"active-profile: {error}"))

        if frontend_url and expected_brand:
            try:
                # No auth header: a different-origin frontend must not get the API token.
                html = (await _get(client, frontend_url.rstrip("/"), {})).text
                detail = f"'{expected_brand}' present in frontend HTML"
                results.append(StepResult("frontend-branding", expected_brand in html, detail))
            except Exception as error:
                results.append(StepResult("frontend-branding", False, f"frontend-branding: {error}"))
    finally:
        if owns_client:
            await client.aclose()

    return results


def run(
    base_url: str,
    expected_profile: str,
    *,
    frontend_url: str | None = None,
    expected_brand: str | None = None,
    token: str | None = None,
) -> int:
    """Synchronous wrapper: prints each step and returns 0 only if all passed."""
    results = asyncio.run(
        run_checks(
            base_url,
            expected_profile,
            frontend_url=frontend_url,
            expected_brand=expected_brand,
            token=token,
        )
    )
    for step in results:
        marker = "ok  " if step.ok else "FAIL"
        print(f"[{marker}] {step.name}: {step.detail}")
    failed = [step.name for step in results if not step.ok]
    if failed:
        print(f"smoke check failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0
