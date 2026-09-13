"""CLI entry point for Ortho Karajan Radar backend jobs.

Usage:
    python -m app.cli ingest
    python -m app.cli digest
"""

from __future__ import annotations

import sys

import click

from app.jobs.daily_digest import run as run_digest
from app.jobs.daily_ingestion import run as run_ingestion


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


if __name__ == "__main__":
    cli()
