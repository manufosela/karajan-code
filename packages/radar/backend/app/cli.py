"""CLI entry point for Ortho Frontier Radar backend jobs.

Usage:
    python -m app.cli ingest
"""

from __future__ import annotations

import sys

import click

from app.jobs.daily_ingestion import run as run_ingestion


@click.group()
def cli() -> None:
    """Ortho Frontier Radar CLI."""


@cli.command()
def ingest() -> None:
    """Run the daily ingestion job for all enabled sources."""
    exit_code = run_ingestion()
    sys.exit(exit_code)


if __name__ == "__main__":
    cli()
