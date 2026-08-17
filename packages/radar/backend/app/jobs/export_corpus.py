"""Export the instance's corpus to a directory karajan-rag can index.

Meant to run after the daily ingestion, and before ``karajan-rag index``. It
is a separate job rather than a step of the ingestion on purpose: an instance
that never publishes a corpus should not pay for one, and an export that fails
should not make the ingestion look like it failed.

Usage:

    python -m app.jobs.export_corpus [DIRECTORY]

The directory defaults to ``RADAR_CORPUS_DIR``. There is no built-in fallback
path: writing a corpus somewhere nobody asked for is worse than refusing to
write one, because the mistake is invisible until something indexes it.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from app.core.database import async_session_factory, engine
from app.core.logging import configure_logging, get_logger
from app.corpus.export import CorpusExporter

logger = get_logger(__name__)

_ENV_VAR = "RADAR_CORPUS_DIR"


def _destination(argv: list[str]) -> Path:
    """Where to write, from the argument or the environment.

    Raises:
        ValueError: If neither says. Guessing a path here would produce a
            corpus in a place nobody intended, and it would look successful.
    """
    if len(argv) > 1:
        return Path(argv[1]).expanduser()

    from_env = os.environ.get(_ENV_VAR)
    if not from_env:
        raise ValueError(
            f"no destination: pass a directory, or set {_ENV_VAR} to the corpus root that karajan-rag indexes"
        )

    return Path(from_env).expanduser()


async def main(argv: list[str] | None = None) -> int:
    """Run the export.

    Returns:
        0 on success, 1 on failure.
    """
    configure_logging()

    try:
        destination = _destination(argv if argv is not None else sys.argv)
    except ValueError as exc:
        logger.error("corpus_export_no_destination", error=str(exc))
        return 1

    logger.info("corpus_export_starting", root=str(destination))

    try:
        async with async_session_factory() as session:
            result = await CorpusExporter(destination).export(session)
    except Exception as exc:
        logger.error("corpus_export_failed", root=str(destination), error=str(exc))
        return 1
    finally:
        await engine.dispose()

    logger.info(
        "corpus_export_completed",
        root=str(destination),
        exported=result.exported,
        quarantined=result.quarantined,
    )
    return 0


def run() -> int:
    """Entry point."""
    return asyncio.run(main())


if __name__ == "__main__":
    sys.exit(run())
