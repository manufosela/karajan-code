"""Service for generating daily digest content from high-relevance signals."""

import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.delivery.teams_webhook import TeamsWebhookService
from app.models.daily_digest import DailyDigest
from app.models.research_item import ResearchItem

logger = logging.getLogger(__name__)

DEFAULT_SCORE_THRESHOLD = 6.0
DEFAULT_MAX_ITEMS = 5


class DigestService:
    """Generates daily digest content from recent high-relevance signals."""

    def __init__(self, teams_webhook: TeamsWebhookService | None = None) -> None:
        self.teams_webhook = teams_webhook

    async def generate(
        self,
        session: AsyncSession,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
        max_items: int = DEFAULT_MAX_ITEMS,
    ) -> dict[str, Any] | None:
        """Query high-relevance signals and generate digest content.

        Returns:
            Dict with items_included, payload (html_content + adaptive_card),
            or None if no signals meet the threshold.
        """
        items = await self._fetch_top_signals(session, score_threshold, max_items)
        if not items:
            logger.info("No signals above threshold %.1f — skipping digest", score_threshold)
            return None

        items_included = [str(item.id) for item in items]
        html_content = self._build_html(items)
        adaptive_card = self._build_adaptive_card(items)

        return {
            "items_included": items_included,
            "payload": {
                "html_content": html_content,
                "adaptive_card": adaptive_card,
            },
        }

    async def trigger(
        self,
        session: AsyncSession,
        channel: str = "teams",
        deliver: bool = False,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
        max_items: int = DEFAULT_MAX_ITEMS,
    ) -> DailyDigest | None:
        """Generate digest, persist to DB, and optionally deliver.

        Returns:
            The created DailyDigest record, or None if no content was generated.
        """
        content = await self.generate(session, score_threshold, max_items)
        if content is None:
            return None

        digest = DailyDigest(
            digest_date=date.today(),
            items_included=content["items_included"],
            delivery_channel=channel,
            delivery_status="pending",
            payload=content["payload"],
        )
        session.add(digest)
        await session.flush()

        if deliver and channel == "teams" and self.teams_webhook:
            success = await self.teams_webhook.send_card(content["payload"]["adaptive_card"])
            if success:
                digest.delivery_status = "sent"
                digest.sent_at = datetime.now(UTC)
            else:
                digest.delivery_status = "failed"
            session.add(digest)
            await session.flush()

        await session.refresh(digest)
        return digest

    async def _fetch_top_signals(
        self,
        session: AsyncSession,
        score_threshold: float,
        max_items: int,
    ) -> list[ResearchItem]:
        """Fetch research items above the score threshold, ordered by score desc."""
        query = (
            select(ResearchItem)
            .where(
                ResearchItem.strategic_relevance_score.isnot(None),
                ResearchItem.strategic_relevance_score >= Decimal(str(score_threshold)),
            )
            .order_by(desc(ResearchItem.strategic_relevance_score))
            .limit(max_items)
        )
        result = await session.execute(query)
        return list(result.scalars().all())

    @staticmethod
    def _build_html(items: list[ResearchItem]) -> str:
        """Build HTML content for the digest."""
        today = date.today().isoformat()
        lines = [
            f"<h1>OFR Daily Digest — {today}</h1>",
            "<hr>",
        ]
        for item in items:
            score = item.strategic_relevance_score or 0
            summary = item.executive_summary_en or "No summary available"
            action = item.recommended_action or "monitor"
            lines.append(f"<h2>{item.original_title}</h2>")
            lines.append(f"<p><strong>Score:</strong> {score}/10</p>")
            lines.append(f"<p><strong>Action:</strong> {action}</p>")
            lines.append(f"<p>{summary}</p>")
            lines.append("<hr>")
        return "\n".join(lines)

    @staticmethod
    def _build_adaptive_card(items: list[ResearchItem]) -> dict[str, Any]:
        """Build an Adaptive Card JSON payload for Teams."""
        today = date.today().isoformat()
        body: list[dict[str, Any]] = [
            {
                "type": "TextBlock",
                "text": f"OFR Daily Digest — {today}",
                "size": "Large",
                "weight": "Bolder",
                "wrap": True,
            },
        ]

        for item in items:
            score = float(item.strategic_relevance_score or 0)
            summary = item.executive_summary_en or "No summary available"
            action = item.recommended_action or "monitor"

            body.append(
                {
                    "type": "Container",
                    "separator": True,
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": item.original_title,
                            "weight": "Bolder",
                            "wrap": True,
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "Score", "value": f"{score}/10"},
                                {"title": "Action", "value": action},
                            ],
                        },
                        {
                            "type": "TextBlock",
                            "text": summary,
                            "wrap": True,
                        },
                    ],
                }
            )

        return {
            "type": "AdaptiveCard",
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.4",
            "body": body,
        }
