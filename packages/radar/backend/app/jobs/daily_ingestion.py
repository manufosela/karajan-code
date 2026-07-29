"""Daily ingestion Cloud Run job.

Runs all enabled connectors via IngestionOrchestrator, then processes
new items through the LLM signal pipeline for classification, scoring,
and summary generation. Handles graceful shutdown on SIGTERM.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
import sys

from sqlalchemy import select

from app.connectors.registry import create_default_registry
from app.core.database import async_session_factory, engine
from app.core.logging import configure_logging, get_logger
from app.llm import get_provider
from app.models.research_item import ResearchItem
from app.services.ingestion import IngestionOrchestrator
from app.services.signal_pipeline import SignalPipelineService

logger = get_logger(__name__)


def _create_shutdown_handler(event: asyncio.Event):
    """Return a signal handler that sets the shutdown event."""

    def _handler(*_args):
        logger.info("SIGTERM received, initiating graceful shutdown")
        event.set()

    return _handler


async def main() -> int:
    """Entry point for the daily ingestion job.

    Returns:
        0 on success, 1 on failure.
    """
    configure_logging()
    logger.info("Daily ingestion job starting")

    shutdown_event = asyncio.Event()

    # Register SIGTERM handler for graceful shutdown (not supported on Windows)
    loop = asyncio.get_running_loop()
    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGTERM, _create_shutdown_handler(shutdown_event))

    if shutdown_event.is_set():
        logger.info("Shutdown requested before ingestion started, exiting")
        return 0

    registry = create_default_registry()

    try:
        # Phase 1: Fetch and ingest from all sources
        async with async_session_factory() as session:
            orchestrator = IngestionOrchestrator(session=session, registry=registry)
            runs = await orchestrator.run_all()
            await session.commit()

            # Log per-source statistics
            total_fetched = 0
            total_new = 0
            total_duplicate = 0
            failed_count = 0

            for run in runs:
                source_name = str(run.source_id)
                logger.info(
                    "Source ingestion result",
                    source=source_name,
                    status=run.status,
                    items_fetched=run.items_fetched,
                    items_new=run.items_new,
                    items_duplicate=run.items_duplicate,
                    errors=len(run.errors) if run.errors else 0,
                )
                total_fetched += run.items_fetched
                total_new += run.items_new
                total_duplicate += run.items_duplicate
                if run.status == "failed":
                    failed_count += 1

            logger.info(
                "Ingestion phase completed",
                sources_processed=len(runs),
                sources_failed=failed_count,
                total_fetched=total_fetched,
                total_new=total_new,
                total_duplicate=total_duplicate,
            )

        # Phase 2: Process unscored items through LLM pipeline
        if shutdown_event.is_set():
            logger.info("Shutdown requested, skipping LLM processing")
            return 0

        try:
            # Auto-register providers by importing them
            import app.llm.ollama_provider  # noqa: F401
            import app.llm.openai_provider  # noqa: F401
            from app.profiles.active import get_active_profile

            # Which backend and models to use is part of the radar's profile,
            # so an instance can run on a local model without a code change.
            llm = get_active_profile().llm

            # Use cheap model for classification/scoring, premium for summaries
            provider = get_provider(llm.provider, model=llm.fast_model)
            summary_provider = get_provider(llm.provider, model=llm.default_model)
            logger.info(
                "LLM providers initialized",
                fast_model=llm.fast_model,
                summary_model=llm.default_model,
                provider=llm.provider,
            )
        except Exception as e:
            logger.warning("No LLM provider available, skipping signal processing", error=str(e))
            return 0

        pipeline = SignalPipelineService(provider, summary_provider=summary_provider)
        processed = 0
        errors = 0

        async with async_session_factory() as session:
            # Find items that haven't been processed by LLM yet
            result = await session.execute(
                select(ResearchItem)
                .where(ResearchItem.scientific_strength_score.is_(None))
                .order_by(ResearchItem.created_at.desc())
                .limit(50)  # Process in batches to stay within Cloud Run timeout
            )
            unprocessed = result.scalars().all()

            logger.info("LLM processing phase", items_to_process=len(unprocessed))

            for item in unprocessed:
                if shutdown_event.is_set():
                    logger.info("Shutdown requested, stopping LLM processing")
                    break

                try:
                    pipeline_result = await pipeline.process(item, session)
                    await session.commit()
                    processed += 1
                    logger.info(
                        "Signal processed",
                        item_id=str(item.id),
                        title=item.original_title[:60],
                        status=pipeline_result.status,
                        duration_ms=pipeline_result.duration_ms,
                    )
                except Exception:
                    logger.exception("Failed to process signal", item_id=str(item.id))
                    await session.rollback()
                    errors += 1

            logger.info(
                "Daily ingestion job completed",
                items_processed=processed,
                items_failed=errors,
            )

        return 0

    except Exception:
        logger.exception("Daily ingestion job failed")
        return 1

    finally:
        # Always dispose engine to clean up connections
        await engine.dispose()
        logger.info("Database connections disposed")


def run() -> int:
    """Synchronous wrapper for main(), suitable for CLI invocation."""
    return asyncio.run(main())


if __name__ == "__main__":
    sys.exit(run())
