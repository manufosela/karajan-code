"""Ingestion orchestrator service.

Coordinates the full ingestion pipeline: fetch from connectors, normalize,
deduplicate against existing items, persist new research items, and record
ingestion run statistics.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors.base import BaseConnector, ConnectorResult, NormalizedPaper
from app.connectors.registry import ConnectorRegistry
from app.core.logging import get_logger
from app.models.ingestion_run import IngestionRun
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.security.injection_scan import scan_record
from app.services.deduplication import (
    DedupCandidate,
    ExistingItem,
    compute_content_hash,
    deduplicate,
)
from app.services.normalization import (
    clean_abstract,
    detect_language,
    normalize_title,
    parse_authors,
    standardize_date,
)

logger = get_logger(__name__)


class IngestionOrchestrator:
    """Orchestrates the ingestion pipeline across all enabled connectors.

    Runs connectors concurrently, normalizes and deduplicates results,
    persists new items, and creates ingestion run records with statistics.
    """

    def __init__(self, session: AsyncSession, registry: ConnectorRegistry) -> None:
        self._session = session
        self._registry = registry

    async def run_all(self) -> list[IngestionRun]:
        """Run all enabled connectors and process their results.

        Returns:
            List of IngestionRun records, one per connector that was executed.
        """
        # 1. Query enabled sources
        result = await self._session.execute(select(Source).where(Source.enabled.is_(True)))
        sources = list(result.scalars().all())
        if not sources:
            return []

        # 2. Match sources to registered connectors
        pairs: list[tuple[Any, BaseConnector]] = []
        for source in sources:
            name_lower = source.name.lower()
            if name_lower not in self._registry.registered_names:
                logger.debug("No connector for source, skipping", source=source.name)
                continue
            try:
                connector = self._registry.get(source.name, config=source.config or {})
                pairs.append((source, connector))
            except Exception as exc:
                logger.error(
                    "Failed to instantiate connector",
                    source=source.name,
                    error=str(exc),
                )

        if not pairs:
            return []

        # 3. Load existing items for deduplication
        existing_items = await self._load_existing_items()

        # 4. Run all connectors concurrently
        tasks = [self._run_single(connector) for _, connector in pairs]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 5. Process results and create ingestion runs
        runs: list[IngestionRun] = []
        for (source, _connector), connector_result in zip(pairs, results, strict=True):
            run = self._process_result(source, connector_result, existing_items)
            self._session.add(run)
            runs.append(run)

        await self._session.flush()
        return runs

    async def _load_existing_items(self) -> list[ExistingItem]:
        """Query existing research items for deduplication (minimal columns)."""
        stmt = select(
            ResearchItem.id,
            ResearchItem.content_hash,
            ResearchItem.doi,
            ResearchItem.normalized_title,
            ResearchItem.source_id,
        )
        result = await self._session.execute(stmt)
        return [
            ExistingItem(
                id=str(row.id),
                content_hash=row.content_hash or "",
                doi=row.doi,
                normalized_title=row.normalized_title,
                source_id=str(row.source_id),
            )
            for row in result.all()
        ]

    @staticmethod
    async def _run_single(connector: BaseConnector) -> ConnectorResult:
        """Run a single connector, ensuring close() is always called."""
        try:
            return await connector.run()
        finally:
            await connector.close()

    def _process_result(
        self,
        source: Any,
        result: ConnectorResult | BaseException,
        existing_items: list[ExistingItem],
    ) -> IngestionRun:
        """Build an IngestionRun from a connector result or failure."""
        run = IngestionRun(source_id=source.id, status="running")

        if isinstance(result, BaseException):
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.items_fetched = 0
            run.items_new = 0
            run.items_duplicate = 0
            run.items_processed = 0
            run.errors = [{"message": str(result), "type": type(result).__name__}]
            return run

        run.started_at = result.started_at or datetime.utcnow()
        run.items_fetched = result.total_fetched
        errors: list[dict[str, Any]] = list(result.errors)
        items_new = 0
        items_duplicate = 0

        for paper in result.papers:
            try:
                new_item = self._process_paper(paper, source, existing_items)
                if new_item is not None:
                    self._session.add(new_item)
                    items_new += 1
                else:
                    items_duplicate += 1
            except Exception as exc:
                logger.warning(
                    "Failed to process paper",
                    source=source.name,
                    error=str(exc),
                )
                errors.append({"message": str(exc), "paper_title": paper.title[:200]})

        run.items_new = items_new
        run.items_duplicate = items_duplicate
        run.items_processed = items_new + items_duplicate
        run.errors = errors if errors else []
        run.status = "completed"
        run.completed_at = result.completed_at or datetime.utcnow()
        return run

    def _process_paper(
        self,
        paper: NormalizedPaper,
        source: Any,
        existing_items: list[ExistingItem],
    ) -> ResearchItem | None:
        """Normalize, deduplicate, and optionally create a ResearchItem.

        Returns:
            A new ResearchItem if the paper is new, or None if duplicate.
        """
        norm_title = normalize_title(paper.title)
        authors = parse_authors(paper.authors)
        pub_date = standardize_date(paper.publication_date)
        abstract = clean_abstract(paper.abstract)
        language = detect_language(abstract or norm_title)

        external_id = paper.doi or paper.pmid or paper.nct_id or paper.arxiv_id or norm_title
        content_hash = compute_content_hash(str(source.id), external_id)

        candidate = DedupCandidate(
            source_id=str(source.id),
            external_id=external_id,
            doi=paper.doi,
            normalized_title=norm_title,
        )
        verdict = deduplicate(candidate, existing_items)

        if verdict.verdict != "new":
            return None

        # Naive UTC, matching the other timestamps on this model, but without
        # the deprecated utcnow(). The rest of this file still uses it; that
        # is existing debt and cleaning it up would change timestamps this
        # change has no business touching.
        processed_at = datetime.now(UTC).replace(tzinfo=None)

        # Scan before the item exists, not after: this is the boundary where
        # third-party text enters, and every field below travels into a prompt
        # later on. Findings are recorded, not acted on -- quarantine is a
        # separate decision and does not belong in the ingestion path.
        injection_scan = scan_record(
            scanned_at=processed_at,
            title=paper.title,
            abstract=abstract,
            journal_or_origin=paper.journal_or_origin,
        )
        if injection_scan["fields"]:
            logger.warning(
                "injection_patterns_in_ingested_item",
                source=source.name,
                external_id=external_id,
                fields=sorted(injection_scan["fields"]),
            )

        item = ResearchItem(
            source_id=source.id,
            doi=paper.doi,
            pmid=paper.pmid,
            nct_id=paper.nct_id,
            arxiv_id=paper.arxiv_id,
            original_url=paper.original_url,
            original_title=paper.title,
            normalized_title=norm_title,
            authors=authors,
            publication_date=pub_date,
            abstract=abstract,
            journal_or_origin=paper.journal_or_origin,
            document_type=paper.document_type,
            language=language,
            content_hash=content_hash,
            injection_scan=injection_scan,
            processing_timestamp=processed_at,
        )

        # Add to in-memory dedup pool for same-batch detection
        existing_items.append(
            ExistingItem(
                id=str(item.id),
                content_hash=content_hash,
                doi=paper.doi,
                normalized_title=norm_title,
                source_id=str(source.id),
            )
        )

        return item
