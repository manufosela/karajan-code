"""What the ingested item looks like after the pipeline has run on it.

The last link of the path in KRD-TSK-0008. The LLM is doubled through the
front door -- SignalPipelineService already takes a provider in its
constructor -- and everything else is real, including the write of the
processing timestamp that KRD-BUG-0003 was aborting on until it was fixed.

The assertions look at the row afterwards rather than at what the double
returned. A pipeline that did nothing at all would still hand back a valid
answer from the fake, so believing the fake would prove nothing.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.research_item import ResearchItem
from app.services.signal_pipeline import SignalPipelineService
from tests.smoke.fake_llm import FakeLLMProvider
from tests.smoke.test_ingestion_reaches_the_database import ingested  # noqa: F401

pytestmark = pytest.mark.smoke


async def _first_item(session, source) -> ResearchItem:
    result = await session.execute(select(ResearchItem).where(ResearchItem.source_id == source.id))
    return list(result.scalars().all())[0]


class TestThePipelineAnalysesWhatWasIngested:
    async def test_an_ingested_item_comes_out_analysed(self, ingested, session) -> None:  # noqa: F811
        _, source = ingested
        item = await _first_item(session, source)

        await SignalPipelineService(FakeLLMProvider()).process(item, session)
        await session.commit()
        await session.refresh(item)

        assert item.thematic_tags
        assert item.strategic_relevance_score is not None
        assert item.executive_summary_en

    async def test_the_processing_timestamp_reaches_postgres(self, ingested, session) -> None:  # noqa: F811
        """KRD-BUG-0003: this write aborted the transaction on every item,
        because the value was timezone-aware and the model declared the column
        without one. SQLite took it either way, so only here does it show."""
        _, source = ingested
        item = await _first_item(session, source)

        await SignalPipelineService(FakeLLMProvider()).process(item, session)
        await session.commit()
        await session.refresh(item)

        assert item.processing_timestamp is not None

    async def test_every_stage_called_the_model(self, ingested, session) -> None:  # noqa: F811
        """A stage skipped in silence would leave a row that still looks
        analysed, because the stages before it filled the fields a reader
        checks first."""
        _, source = ingested
        item = await _first_item(session, source)

        provider = FakeLLMProvider()
        await SignalPipelineService(provider).process(item, session)

        assert len(provider.calls) >= 5
