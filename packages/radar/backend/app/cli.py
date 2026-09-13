"""CLI entry point for Ortho Karajan Radar backend jobs.

Usage:
    python -m app.cli ingest
    python -m app.cli digest
    python -m app.cli verify --url https://... --profile software-engineering
"""

from __future__ import annotations

import sys

import click

from app.jobs.daily_digest import run as run_digest
from app.jobs.daily_ingestion import run as run_ingestion
from app.jobs.post_deploy_check import run as run_verify


@click.group()
def cli() -> None:
    """Ortho Karajan Radar CLI."""


@cli.command()
def ingest() -> None:
    """Run the daily ingestion job for all enabled sources."""
    exit_code = run_ingestion()
    sys.exit(exit_code)


@cli.command()
def digest() -> None:
    """Generate and deliver the daily digest of high-relevance signals."""
    exit_code = run_digest()
    sys.exit(exit_code)


@cli.command()
@click.option("--url", required=True, help="Base URL of the deployed API.")
@click.option("--profile", required=True, help="Radar Profile id this instance must declare.")
@click.option("--frontend-url", default=None, help="Frontend URL, to check its baked branding.")
@click.option("--brand", default=None, help="Branding string expected in the frontend HTML.")
@click.option("--token", default=None, help="Bearer token (e.g. gcloud auth print-identity-token).")
def verify(url: str, profile: str, frontend_url: str | None, brand: str | None, token: str | None) -> None:
    """Read-only smoke check of a deployed instance before declaring it live."""
    exit_code = run_verify(
        url,
        profile,
        frontend_url=frontend_url,
        expected_brand=brand,
        token=token,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    cli()
