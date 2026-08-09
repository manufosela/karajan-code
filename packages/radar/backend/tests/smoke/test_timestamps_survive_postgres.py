"""Timestamps written by the application have to be accepted by PostgreSQL.

Regression test for KRD-BUG-0003. The pipeline wrote an aware datetime into a
column the model declared without a timezone, so SQLAlchemy cast it to
TIMESTAMP WITHOUT TIME ZONE and asyncpg refused it -- aborting the transaction
and leaving the item unanalysed.

It lives in the smoke suite because it cannot live anywhere else: SQLite
stores datetimes as text and takes aware and naive alike, so on the unit suite
this test would pass with the bug still in place, which is worse than not
having it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select

from app.models.daily_digest import DailyDigest
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.models.user import User

pytestmark = pytest.mark.smoke


class TestAwareTimestampsAreAccepted:
    async def test_a_research_item_takes_an_aware_processing_timestamp(self, session) -> None:
        """This is the write that KRD-BUG-0003 aborted."""
        source = Source(
            id=uuid.uuid4(),
            name="smoke-timestamps",
            source_type="api",
            category="core",
            priority=1,
            enabled=False,
            config={},
            base_url="https://smoke.invalid",
        )
        item = ResearchItem(
            id=uuid.uuid4(),
            source_id=source.id,
            original_title="Timestamp regression",
            document_type="paper",
            content_hash=f"smoke-ts-{uuid.uuid4().hex}",
            processing_timestamp=datetime.now(UTC),
        )
        session.add_all([source, item])
        await session.commit()

        stored = (await session.execute(select(ResearchItem).where(ResearchItem.id == item.id))).scalar_one()
        assert stored.processing_timestamp is not None

        await session.execute(delete(ResearchItem).where(ResearchItem.id == item.id))
        await session.execute(delete(Source).where(Source.id == source.id))
        await session.commit()

    async def test_a_digest_takes_an_aware_sent_at(self, session) -> None:
        """Same shape of bug, same column type, different table: the digest
        marks itself sent with an aware datetime."""
        digest = DailyDigest(
            id=uuid.uuid4(),
            digest_date=datetime.now(UTC).date(),
            items_included=[],
            delivery_channel="teams",
            delivery_status="sent",
            payload={},
            sent_at=datetime.now(UTC),
        )
        session.add(digest)
        await session.commit()

        await session.execute(delete(DailyDigest).where(DailyDigest.id == digest.id))
        await session.commit()

    async def test_a_user_records_activity_without_a_timezone(self, session) -> None:
        """`users` keeps naive columns for now (KRD-TSK-0014), so what has to
        hold here is the opposite: the naive value the code writes is accepted.
        An aware one would be rejected on every authenticated request."""
        user = User(
            id=uuid.uuid4(),
            email=f"smoke-{uuid.uuid4().hex[:8]}@example.invalid",
            password_hash="not-a-real-hash",
            name="Smoke",
            role="user",
            is_active=True,
            last_active_at=datetime.now(UTC).replace(tzinfo=None),
        )
        session.add(user)
        await session.commit()

        await session.execute(delete(User).where(User.id == user.id))
        await session.commit()
