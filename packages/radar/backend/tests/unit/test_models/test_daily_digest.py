"""Tests for the DailyDigest SQLAlchemy model."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_digest import DailyDigest


@pytest.mark.asyncio
async def test_create_daily_digest_minimal(test_session: AsyncSession):
    """Create a daily digest with required fields."""
    digest = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["uuid-1", "uuid-2"],
        delivery_channel="teams",
    )
    test_session.add(digest)
    await test_session.flush()

    assert digest.id is not None
    assert digest.digest_date == date(2024, 6, 15)
    assert digest.items_included == ["uuid-1", "uuid-2"]
    assert digest.delivery_channel == "teams"
    assert digest.delivery_status == "pending"  # default
    assert digest.payload is None
    assert digest.sent_at is None


@pytest.mark.asyncio
async def test_create_daily_digest_sent(test_session: AsyncSession):
    """Create a sent daily digest with full payload."""
    now = datetime.now(UTC)
    digest = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["uuid-1", "uuid-2", "uuid-3"],
        delivery_channel="email",
        delivery_status="sent",
        payload={
            "subject": "Daily Digest - June 15",
            "body": "<html>...</html>",
            "items_count": 3,
        },
        sent_at=now,
    )
    test_session.add(digest)
    await test_session.flush()

    result = await test_session.get(DailyDigest, digest.id)
    assert result.delivery_status == "sent"
    assert result.delivery_channel == "email"
    assert result.payload["items_count"] == 3
    assert result.sent_at is not None


@pytest.mark.asyncio
async def test_daily_digest_failed_status(test_session: AsyncSession):
    """Create a failed daily digest."""
    digest = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=[],
        delivery_channel="teams",
        delivery_status="failed",
    )
    test_session.add(digest)
    await test_session.flush()

    assert digest.delivery_status == "failed"


@pytest.mark.asyncio
async def test_daily_digest_query_by_channel(test_session: AsyncSession):
    """Query daily digests by delivery channel."""
    d1 = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["a"],
        delivery_channel="teams",
    )
    d2 = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["b"],
        delivery_channel="email",
    )
    d3 = DailyDigest(
        digest_date=date(2024, 6, 16),
        items_included=["c"],
        delivery_channel="teams",
    )
    test_session.add_all([d1, d2, d3])
    await test_session.flush()

    result = await test_session.execute(
        select(DailyDigest).where(DailyDigest.delivery_channel == "teams")
    )
    teams_digests = result.scalars().all()
    assert len(teams_digests) == 2


@pytest.mark.asyncio
async def test_daily_digest_query_by_date(test_session: AsyncSession):
    """Query daily digests by date."""
    d1 = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["a"],
        delivery_channel="teams",
    )
    d2 = DailyDigest(
        digest_date=date(2024, 6, 16),
        items_included=["b"],
        delivery_channel="teams",
    )
    test_session.add_all([d1, d2])
    await test_session.flush()

    result = await test_session.execute(
        select(DailyDigest).where(DailyDigest.digest_date == date(2024, 6, 16))
    )
    digests = result.scalars().all()
    assert len(digests) == 1
    assert digests[0].items_included == ["b"]


@pytest.mark.asyncio
async def test_daily_digest_update_status(test_session: AsyncSession):
    """Update digest from pending to sent."""
    digest = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=["uuid-1"],
        delivery_channel="teams",
    )
    test_session.add(digest)
    await test_session.flush()

    assert digest.delivery_status == "pending"

    digest.delivery_status = "sent"
    digest.sent_at = datetime.now(UTC)
    await test_session.flush()

    result = await test_session.get(DailyDigest, digest.id)
    assert result.delivery_status == "sent"
    assert result.sent_at is not None


@pytest.mark.asyncio
async def test_daily_digest_repr(test_session: AsyncSession):
    """DailyDigest.__repr__ should return meaningful string."""
    digest = DailyDigest(
        digest_date=date(2024, 6, 15),
        items_included=[],
        delivery_channel="email",
    )
    test_session.add(digest)
    await test_session.flush()

    repr_str = repr(digest)
    assert "DailyDigest" in repr_str
    assert "email" in repr_str
