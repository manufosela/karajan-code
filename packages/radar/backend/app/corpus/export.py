"""Writing the corpus out as a directory karajan-rag can index.

The layout is the contract with the engine, because karajan-rag resolves a
document's sensitivity from its path:

    <root>/sources/    public   -- what the publishers put out
    <root>/analysis/   internal -- what this radar concluded
    <root>/quarantine/ excluded -- items that tripped the injection scan

The engine is told about the first two by ``karajan.config.json``
(``easy.sensitivity: internal`` plus a prefix rule marking ``sources/`` as
public). ``quarantine/`` is simply not indexed: everything indexed is
servable, since retrieval does not filter, so an item carrying an injection
attempt has to be stopped here or not at all.

Each export rewrites those directories from empty rather than updating them in
place. A corpus that keeps a document for an item that was deleted, or two
copies of one whose identifier changed, answers questions with material the
radar no longer stands behind -- and nothing downstream can tell that it did.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.corpus.documents import (
    is_quarantined,
    render_analysis_document,
    render_source_document,
)
from app.models.research_item import ResearchItem

logger = get_logger(__name__)

SOURCES_DIR = "sources"
ANALYSIS_DIR = "analysis"
QUARANTINE_DIR = "quarantine"

_MANAGED_DIRS = (SOURCES_DIR, ANALYSIS_DIR, QUARANTINE_DIR)


@dataclass(frozen=True)
class ExportResult:
    """What the export wrote, in terms a person can check against the radar."""

    items: int
    quarantined: int
    root: Path

    @property
    def exported(self) -> int:
        """Items that reached the consultable corpus."""
        return self.items - self.quarantined

    def summary(self) -> str:
        """One line for a job log."""
        return f"{self.exported} item(s) exported to {self.root}, {self.quarantined} quarantined"


class CorpusExporter:
    """Writes the instance's research items out as a corpus directory."""

    def __init__(self, root: Path) -> None:
        self._root = root

    async def export(self, session: AsyncSession) -> ExportResult:
        """Write every research item out, and report what happened.

        Args:
            session: Session on the instance's database.

        Returns:
            Counts of what was written and what was held back.
        """
        self._clear_managed_dirs()

        items = list((await session.execute(select(ResearchItem))).scalars().all())
        quarantined = 0

        for item in items:
            if is_quarantined(item):
                quarantined += 1
                self._write(QUARANTINE_DIR, item, render_source_document(item))
                continue

            self._write(SOURCES_DIR, item, render_source_document(item))
            self._write(ANALYSIS_DIR, item, render_analysis_document(item))

        result = ExportResult(items=len(items), quarantined=quarantined, root=self._root)
        logger.info(
            "corpus_exported",
            root=str(self._root),
            items=result.items,
            exported=result.exported,
            quarantined=result.quarantined,
        )
        return result

    def _clear_managed_dirs(self) -> None:
        """Start each export from empty, and touch nothing else.

        Only the three directories this writes are removed. The root is also
        where an operator keeps ``karajan.config.json`` and where karajan-rag
        leaves its index; wiping the root would take both with it.
        """
        for name in _MANAGED_DIRS:
            directory = self._root / name
            if directory.exists():
                shutil.rmtree(directory)
            directory.mkdir(parents=True)

    def _write(self, directory: str, item: ResearchItem, document: str) -> None:
        """Write one document, named so the two halves of an item line up."""
        path = self._root / directory / f"{item.id}.md"
        path.write_text(document, encoding="utf-8")
