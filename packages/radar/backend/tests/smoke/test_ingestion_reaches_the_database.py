"""From a source nobody has queried before to a row in the database.

This is the path the card is about. The unit suite covers every piece of it
with the neighbours doubled; nothing covered the pieces meeting each other on
a real database.

One double, and it goes in through the front door: the source is declared
with RADAR_CONNECTORS, the same mechanism an instance uses for its own
connectors. What gets tested is the route a real deployment takes, rather
than the registry's willingness to be patched.

Everything else is real: PostgreSQL, the migrations, the profile, the
orchestrator, the deduplication and the injection scan. Analysing what was
ingested is the next step, and its own file.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.connectors.registry import create_default_registry
from app.models.ingestion_run import IngestionRun
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.services.ingestion import IngestionOrchestrator
from tests.smoke.fake_source import DOCUMENTS, TAMPERED_DOCUMENT_ID

pytestmark = pytest.mark.smoke

_SOURCE_NAME = "smoke"
_CONNECTOR_SPEC = "smoke=tests.smoke.fake_source:FakeSourceConnector"


@pytest.fixture
async def ingested(session, monkeypatch):
    """Run a real ingestion from the fake source, and clean up after.

    The rows are removed at the end because this database is not thrown away
    between runs: a smoke suite that leaves its own leftovers behind starts
    passing, or failing, for reasons that have nothing to do with the code.

    It also sweeps up before it starts, which is not belt and braces. A
    teardown can fail for reasons of its own -- a broken model mid-debugging
    is enough -- and then every later run inherits sources that are still
    disabled and items that make the deduplication call the new ones
    duplicates. On CI the database is new each time and none of this shows;
    locally it poisons the database until someone drops the schema.

    The order of the deletes is not incidental. `ingestion_runs` references
    `sources` with ON DELETE RESTRICT, so removing the source first raises --
    and PostgreSQL says so where SQLite would have let it through.
    """
    monkeypatch.setenv("RADAR_CONNECTORS", _CONNECTOR_SPEC)

    await _remove_leftovers(session)

    # The orchestrator queries every enabled source, and the seed migration
    # leaves the real ones enabled -- so without this the smoke run goes out
    # to PubMed, arXiv and Crossref over the network. That would make the
    # suite slow, dependent on three third parties being up, and silently
    # useless the day the network is down. Restored below.
    silenced = (
        (await session.execute(select(Source).where(Source.enabled.is_(True), Source.name != _SOURCE_NAME)))
        .scalars()
        .all()
    )
    for other in silenced:
        other.enabled = False
    await session.commit()

    source = Source(
        id=uuid.uuid4(),
        name=_SOURCE_NAME,
        source_type="api",
        category="core",
        priority=1,
        enabled=True,
        # Reaches the connector through the registry, so this doubles as a
        # check that a Source's config actually gets there.
        config={"run_id": uuid.uuid4().hex[:8]},
        base_url="https://smoke.invalid",
    )
    session.add(source)
    await session.commit()

    orchestrator = IngestionOrchestrator(session=session, registry=create_default_registry())
    runs = await orchestrator.run_all()
    await session.commit()

    try:
        yield runs, source
    finally:
        # In a finally because a failing test must not also leave the database
        # worse than it found it: the next run would then fail for a reason
        # that has nothing to do with what broke.
        await _remove_leftovers(session)
        for other in silenced:
            other.enabled = True
        await session.commit()


async def _remove_leftovers(session) -> None:
    """Delete anything a previous run of this fixture left behind.

    By source name rather than by id, because the leftovers are precisely the
    ones whose id nobody kept. Deletes children first: `ingestion_runs`
    references `sources` with ON DELETE RESTRICT.
    """
    stale = (await session.execute(select(Source.id).where(Source.name == _SOURCE_NAME))).scalars().all()
    if not stale:
        return

    await session.execute(delete(ResearchItem).where(ResearchItem.source_id.in_(stale)))
    await session.execute(delete(IngestionRun).where(IngestionRun.source_id.in_(stale)))
    await session.execute(delete(Source).where(Source.id.in_(stale)))
    await session.commit()


async def _items_of(session, source) -> list[ResearchItem]:
    result = await session.execute(select(ResearchItem).where(ResearchItem.source_id == source.id))
    return list(result.scalars().all())


class TestIngestionReachesTheDatabase:
    async def test_a_declared_connector_is_actually_queried(self, ingested, session) -> None:
        """The source was registered through RADAR_CONNECTORS, so this also
        covers the route an instance uses for its own connectors."""
        runs, source = ingested

        assert any(run.source_id == source.id for run in runs)

    async def test_every_document_becomes_a_row(self, ingested, session) -> None:
        _, source = ingested

        items = await _items_of(session, source)

        assert len(items) == len(DOCUMENTS)

    async def test_the_rows_carry_what_the_source_sent(self, ingested, session) -> None:
        """A row that exists but lost its abstract would still pass a count."""
        _, source = ingested

        items = await _items_of(session, source)
        titles = {item.original_title for item in items}

        for document in DOCUMENTS:
            assert any(title.startswith(document["title"]) for title in titles)
        assert all(item.abstract for item in items)


class TestTheInjectionScanRunsOnTheWayIn:
    """KRD-TSK-0004 put the scan in the ingestion path. This is the only test
    that watches it happen against a real database."""

    async def test_every_ingested_row_carries_a_scan_record(self, ingested, session) -> None:
        _, source = ingested

        items = await _items_of(session, source)

        assert all(item.injection_scan is not None for item in items)

    async def test_the_tampered_document_is_flagged(self, ingested, session) -> None:
        _, source = ingested

        items = await _items_of(session, source)
        flagged = [item for item in items if item.injection_scan["fields"]]

        assert len(flagged) == 1
        assert TAMPERED_DOCUMENT_ID in flagged[0].original_url
