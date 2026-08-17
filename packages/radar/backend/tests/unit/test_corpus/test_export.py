"""Tests for writing the corpus out as a directory.

The layout is a contract with karajan-rag, which resolves sensitivity from the
path. So these tests are less about files than about which folder a document
ends up in, and about what happens to the folder on the next run.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.corpus.export import ANALYSIS_DIR, QUARANTINE_DIR, SOURCES_DIR, CorpusExporter
from app.models.research_item import ResearchItem
from app.models.source import Source

_FLAGGED = {
    "catalogue_version": "1.0.0",
    "scanned_at": "x",
    "fields": {"abstract": [{"type": "directive", "pattern": "ignore_previous"}]},
}
_CLEAN = {"catalogue_version": "1.0.0", "scanned_at": "x", "fields": {}}


async def _source(session: AsyncSession) -> Source:
    source = Source(
        id=uuid.uuid4(),
        name="test-source",
        source_type="api",
        category="core",
        priority=1,
        enabled=True,
        config={},
        base_url="https://example.invalid",
    )
    session.add(source)
    await session.flush()
    return source


async def _item(session: AsyncSession, source: Source, **overrides) -> ResearchItem:
    defaults = {
        "id": uuid.uuid4(),
        "source_id": source.id,
        "original_title": "Polymer creep",
        "abstract": "Force decay over time.",
        "document_type": "paper",
        "content_hash": uuid.uuid4().hex,
        "thematic_tags": ["orthodontics"],
        "executive_summary_en": "It matters for fit.",
        "injection_scan": _CLEAN,
    }
    defaults.update(overrides)
    item = ResearchItem(**defaults)
    session.add(item)
    await session.flush()
    return item


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return tmp_path / "corpus"


class TestTheLayoutIsTheContract:
    async def test_each_item_lands_in_both_halves(self, test_session, root) -> None:
        source = await _source(test_session)
        item = await _item(test_session, source)

        await CorpusExporter(root).export(test_session)

        assert (root / SOURCES_DIR / f"{item.id}.md").exists()
        assert (root / ANALYSIS_DIR / f"{item.id}.md").exists()

    async def test_the_two_halves_share_a_name(self, test_session, root) -> None:
        """An operator has to be able to line them up by hand, and so does
        anyone chasing a hit back to the item it came from."""
        source = await _source(test_session)
        await _item(test_session, source)

        await CorpusExporter(root).export(test_session)

        assert {p.name for p in (root / SOURCES_DIR).iterdir()} == {
            p.name for p in (root / ANALYSIS_DIR).iterdir()
        }

    async def test_the_public_half_holds_no_analysis(self, test_session, root) -> None:
        """The folder is what makes a document public, so this is where a
        leak would become one."""
        source = await _source(test_session)
        item = await _item(test_session, source)

        await CorpusExporter(root).export(test_session)

        assert "orthodontics" not in (root / SOURCES_DIR / f"{item.id}.md").read_text()


class TestQuarantineIsNotIndexed:
    async def test_a_flagged_item_stays_out_of_both_halves(self, test_session, root) -> None:
        source = await _source(test_session)
        item = await _item(test_session, source, injection_scan=_FLAGGED)

        await CorpusExporter(root).export(test_session)

        assert not (root / SOURCES_DIR / f"{item.id}.md").exists()
        assert not (root / ANALYSIS_DIR / f"{item.id}.md").exists()

    async def test_it_is_kept_rather_than_dropped(self, test_session, root) -> None:
        """A paper that merely discusses prompt injection trips the patterns
        without being an attack. Out of the index, not out of existence."""
        source = await _source(test_session)
        item = await _item(test_session, source, injection_scan=_FLAGGED)

        await CorpusExporter(root).export(test_session)

        assert (root / QUARANTINE_DIR / f"{item.id}.md").exists()

    async def test_the_result_says_how_many_were_held_back(self, test_session, root) -> None:
        """A quarantine nobody can see is a corpus quietly missing items."""
        source = await _source(test_session)
        await _item(test_session, source)
        await _item(test_session, source, injection_scan=_FLAGGED)

        result = await CorpusExporter(root).export(test_session)

        assert result.items == 2
        assert result.quarantined == 1
        assert result.exported == 1
