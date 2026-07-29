"""Service for delivering Adaptive Card payloads to Microsoft Teams via webhook."""

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
BACKOFF_BASE = 1.0  # seconds
TIMEOUT = 30.0  # seconds

# HTTP status codes that trigger a retry
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class TeamsWebhookService:
    """Delivers Adaptive Card payloads to configured Teams webhook URLs."""

    def __init__(self, webhook_url: str | None = None) -> None:
        self.webhook_url = webhook_url

    async def send_card(
        self,
        card_payload: dict[str, Any],
        webhook_url: str | None = None,
    ) -> bool:
        """Send an Adaptive Card to a Teams webhook.

        Args:
            card_payload: The Adaptive Card JSON object.
            webhook_url: Optional override URL. Falls back to self.webhook_url.

        Returns:
            True if delivered successfully, False otherwise.
        """
        url = webhook_url or self.webhook_url
        if not url:
            logger.warning("No Teams webhook URL configured — skipping delivery")
            return False

        message = self._wrap_card(card_payload)

        try:
            return await self._post_with_retry(url, message)
        except Exception:
            logger.exception("Unexpected error sending Teams webhook")
            return False

    async def _post_with_retry(self, url: str, payload: dict[str, Any]) -> bool:
        """POST payload to url with exponential backoff retry on transient errors."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for attempt in range(MAX_RETRIES):
                try:
                    response = await client.post(url, json=payload)
                except httpx.HTTPError:
                    logger.exception(
                        "HTTP error on attempt %d/%d", attempt + 1, MAX_RETRIES
                    )
                    return False

                if response.status_code == 200:
                    logger.info("Teams webhook delivered successfully")
                    return True

                if response.status_code in _RETRYABLE_STATUS_CODES:
                    wait = BACKOFF_BASE * (2**attempt)
                    logger.warning(
                        "Retryable status %d on attempt %d/%d — waiting %.1fs",
                        response.status_code,
                        attempt + 1,
                        MAX_RETRIES,
                        wait,
                    )
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(wait)
                    continue

                # Non-retryable error (4xx except 429)
                logger.error(
                    "Non-retryable error %d: %s",
                    response.status_code,
                    response.text[:200],
                )
                return False

        # Exhausted all retries
        logger.error("Failed to deliver Teams webhook after %d attempts", MAX_RETRIES)
        return False

    @staticmethod
    def _wrap_card(card: dict[str, Any]) -> dict[str, Any]:
        """Wrap an Adaptive Card in a Teams message envelope."""
        return {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": None,
                    "content": card,
                }
            ],
        }
