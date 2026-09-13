"""Daily digest Cloud Run job.

Generates the digest via DigestService, persists it, and delivers it (Teams)
when a webhook is configured. Graceful shutdown on SIGTERM, like ingestion.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
import sys

from app.core.config import settings
from app.core.database import async_session_factory, engine
from app.core.logging import configure_logging, get_logger
from app.delivery.digest import DigestService
from app.delivery.teams_webhook import TeamsWebhookService

logger = get_logger(__name__)


def _create_shutdown_handler(event: asyncio.Event):
    """Return a signal handler that sets the shutdown event."""

    def _handler(*_args):
        logger.info("SIGTERM received, initiating graceful shutdown")
        event.set()

    return _handler


async def main() -> int:
    """Entry point for the daily digest job. Returns 0 on success (delivered,
    or nothing above the profile threshold), 1 on failure."""
    configure_logging()
    logger.info("Daily digest job starting")

    shutdown_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGTERM, _create_shutdown_handler(shutdown_event))

    if shutdown_event.is_set():
        logger.info("Shutdown requested before digest started, exiting")
        return 0

    try:
        # No webhook configured means no delivery channel: the digest is still
        # generated and persisted, just not pushed anywhere.
        teams_webhook = (
            TeamsWebhookService(webhook_url=settings.TEAMS_WEBHOOK_URL)
            if settings.TEAMS_WEBHOOK_URL
            else None
        )
        service = DigestService(teams_webhook=teams_webhook)

        async with async_session_factory() as session:
            digest = await service.trigger(session, deliver=True)
            await session.commit()

            if digest is None:
                logger.info("No signals above threshold, no digest generated")
            else:
                logger.info(
                    "Daily digest job completed",
                    delivery_status=digest.delivery_status,
                )

        return 0

    except Exception:
        logger.exception("Daily digest job failed")
        return 1

    finally:
        await engine.dispose()
        logger.info("Database connections disposed")


def run() -> int:
    """Synchronous wrapper for main(), suitable for CLI invocation."""
    return asyncio.run(main())


if __name__ == "__main__":
    sys.exit(run())
