"""Tests for DigestService."""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_digest import DailyDigest
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.services.digest import DigestService


async def _create_source(session: AsyncSession, **overrides: Any) -> Source:
    """Helper to create a Source record."""
    defaults = {
        "id": uuid.uuid4(),
        "name": "Test PubMed",
        "source_type": "api",
        "category": "core",
        "priority": 1,
        "enabled": True,
        "config": {},
        "base_url": "https://example.com",
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    source = Source(**defaults)
    session.add(source)
    await session.flush()
    return source


async def _create_research_item(
    session: AsyncSession, source_id: uuid.UUID, **overrides: Any
) -> ResearchItem:
    """Helper to create a ResearchItem record."""
    defaults = {
        "id": uuid.uuid4(),
        "source_id": source_id,
        "original_title": "Test article on orthodontics",
        "document_type": "paper",
        "review_status": "review",
        "language": "en",
        "thematic_tags": [],
        "strategic_buckets": [],
        "authors": [],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    item = ResearchItem(**defaults)
    session.add(item)
    await session.flush()
    return item


class TestDigestServiceGenerateContent:
    """Tests for content generation from high-relevance signals."""

    async def test_generates_digest_with_high_score_signals(
        self, test_session: AsyncSession
    ) -> None:
        """DigestService picks signals above the score threshold."""
        source = await _create_source(test_session)
        # High score — should be included
        item_high = await _create_research_item(
            test_session,
            source.id,
            original_title="High relevance article",
            strategic_relevance_score=Decimal("8.5"),
            executive_summary_en="Important discovery in clear aligners",
            recommended_action="investigate",
        )
        # Low score — should be excluded
        await _create_research_item(
            test_session,
            source.id,
            original_title="Low relevance article",
            strategic_relevance_score=Decimal("3.0"),
        )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=5)

        assert result is not None
        assert len(result["items_included"]) == 1
        assert str(item_high.id) in result["items_included"]

    async def test_returns_none_when_no_signals_above_threshold(
        self, test_session: AsyncSession
    ) -> None:
        """DigestService returns None when no signals meet the threshold."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("2.0"),
        )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=5)

        assert result is None

    async def test_limits_items_to_max(self, test_session: AsyncSession) -> None:
        """DigestService respects the max_items limit."""
        source = await _create_source(test_session)
        for i in range(10):
            await _create_research_item(
                test_session,
                source.id,
                original_title=f"Article {i}",
                strategic_relevance_score=Decimal("9.0"),
            )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=3)

        assert result is not None
        assert len(result["items_included"]) == 3

    async def test_orders_by_score_descending(self, test_session: AsyncSession) -> None:
        """Signals are ordered by strategic_relevance_score desc."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            original_title="Score 7",
            strategic_relevance_score=Decimal("7.0"),
        )
        item_top = await _create_research_item(
            test_session,
            source.id,
            original_title="Score 9",
            strategic_relevance_score=Decimal("9.0"),
        )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=1)

        assert result is not None
        assert str(item_top.id) in result["items_included"]


class TestDigestServicePayload:
    """Tests for payload format (HTML and Adaptive Card)."""

    async def test_payload_contains_html(self, test_session: AsyncSession) -> None:
        """Generated payload includes html_content."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            original_title="HTML test article",
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Test summary",
        )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=5)

        assert result is not None
        assert "html_content" in result["payload"]
        assert "HTML test article" in result["payload"]["html_content"]

    async def test_payload_contains_adaptive_card(self, test_session: AsyncSession) -> None:
        """Generated payload includes a valid Adaptive Card structure."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            original_title="Card test article",
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Test summary for card",
        )
        await test_session.commit()

        service = DigestService()
        result = await service.generate(test_session, score_threshold=6.0, max_items=5)

        assert result is not None
        card = result["payload"]["adaptive_card"]
        assert card["type"] == "AdaptiveCard"
        assert card["version"] == "1.4"
        assert isinstance(card["body"], list)
        assert len(card["body"]) > 0


class TestDigestServiceTrigger:
    """Tests for the trigger method that creates DB records."""

    async def test_trigger_creates_digest_record(
        self, test_session: AsyncSession
    ) -> None:
        """trigger() creates a DailyDigest record in the DB."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Test summary",
        )
        await test_session.commit()

        service = DigestService()
        digest = await service.trigger(
            test_session, channel="teams", deliver=False
        )

        assert digest is not None
        assert isinstance(digest, DailyDigest)
        assert digest.delivery_channel == "teams"
        assert digest.delivery_status == "pending"
        assert digest.digest_date == date.today()
        assert len(digest.items_included) > 0

    async def test_trigger_returns_none_when_no_content(
        self, test_session: AsyncSession
    ) -> None:
        """trigger() returns None when no signals meet the threshold."""
        service = DigestService()
        digest = await service.trigger(
            test_session, channel="teams", deliver=False
        )

        assert digest is None

    async def test_trigger_with_delivery(self, test_session: AsyncSession) -> None:
        """trigger() with deliver=True calls TeamsWebhookService."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Test summary",
        )
        await test_session.commit()

        mock_webhook = AsyncMock()
        mock_webhook.send_card.return_value = True

        service = DigestService(teams_webhook=mock_webhook)
        digest = await service.trigger(
            test_session, channel="teams", deliver=True
        )

        assert digest is not None
        assert digest.delivery_status == "sent"
        assert digest.sent_at is not None
        mock_webhook.send_card.assert_called_once()

    async def test_trigger_delivery_failure_marks_failed(
        self, test_session: AsyncSession
    ) -> None:
        """trigger() marks status as 'failed' when delivery fails."""
        source = await _create_source(test_session)
        await _create_research_item(
            test_session,
            source.id,
            strategic_relevance_score=Decimal("8.0"),
            executive_summary_en="Test summary",
        )
        await test_session.commit()

        mock_webhook = AsyncMock()
        mock_webhook.send_card.return_value = False

        service = DigestService(teams_webhook=mock_webhook)
        digest = await service.trigger(
            test_session, channel="teams", deliver=True
        )

        assert digest is not None
        assert digest.delivery_status == "failed"
        assert digest.sent_at is None
