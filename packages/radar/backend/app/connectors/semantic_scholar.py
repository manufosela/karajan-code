"""Semantic Scholar connector for fetching orthodontic research papers."""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any

from app.connectors.base import BaseConnector, NormalizedPaper
from app.core.logging import get_logger
from app.profiles.active import default_query_for

logger = get_logger(__name__)

# Semantic Scholar Academic Graph API base URL
SS_API_BASE_URL = "https://api.semanticscholar.org/graph/v1"


# Maximum results per page (Semantic Scholar API limit)
MAX_LIMIT = 100

# Fields to request from the API
REQUESTED_FIELDS = ",".join([
    "paperId",
    "title",
    "abstract",
    "venue",
    "year",
    "citationCount",
    "referenceCount",
    "fieldsOfStudy",
    "authors",
    "externalIds",
    "openAccessPdf",
    "publicationDate",
    "url",
])


class SemanticScholarConnector(BaseConnector):
    """Connector for fetching research papers from Semantic Scholar API.

    Uses offset-based pagination and year-range filtering.
    Rate limit: 1 request per 3 seconds (conservative, without API key).
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            source_name="semantic_scholar",
            base_url=SS_API_BASE_URL,
            config=config or {},
            rate_limit=1.0,
            rate_limit_period=3.0,
        )

    async def fetch(
        self,
        query: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        max_results: int = 100,
    ) -> dict[str, Any]:
        """Fetch papers from Semantic Scholar matching orthodontics queries.

        Uses offset-based pagination to accumulate all results.

        Args:
            query: Custom search query. Defaults to orthodontics-related terms.
            date_from: Start date for filtering (year granularity in API).
            date_to: End date for filtering (year granularity in API).
            max_results: Maximum number of results to fetch per page.

        Returns:
            Dict with 'data' list, 'total', 'date_from', 'date_to'.
        """
        if date_from is None:
            date_from = date.today() - timedelta(days=30)
        if date_to is None:
            date_to = date.today()

        search_query = query or default_query_for("semantic_scholar")
        limit = min(max_results, MAX_LIMIT)

        params: dict[str, Any] = {
            "query": search_query,
            "limit": limit,
            "offset": 0,
            "fields": REQUESTED_FIELDS,
            "year": f"{date_from.year}-{date_to.year}",
        }

        all_papers: list[dict[str, Any]] = []

        while True:
            logger.info(
                "Fetching from Semantic Scholar",
                query=search_query,
                limit=limit,
                offset=params["offset"],
            )

            async with self._limiter:
                response = await self._client.get("/paper/search", params=params)
                response.raise_for_status()

            data = response.json()
            papers = data.get("data", [])

            if not papers:
                break

            all_papers.extend(papers)

            # Check if there are more pages
            next_offset = data.get("next")
            if next_offset is None:
                break

            params["offset"] = next_offset

        return {
            "data": all_papers,
            "total": len(all_papers),
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        }

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse Semantic Scholar API response into a list of paper dicts.

        Args:
            raw_data: Dict with 'data' containing the list of paper objects.

        Returns:
            List of dicts, each representing a parsed paper.
        """
        papers = raw_data.get("data", [])

        date_from_str = raw_data.get("date_from")
        date_to_str = raw_data.get("date_to")
        date_from = date.fromisoformat(date_from_str) if date_from_str else None
        date_to = date.fromisoformat(date_to_str) if date_to_str else None

        parsed: list[dict[str, Any]] = []

        for paper in papers:
            try:
                item = self._parse_paper(paper)
                if item is None:
                    continue

                # Client-side date filtering (finer than year granularity)
                if date_from or date_to:
                    pub_date_str = item.get("publication_date")
                    if pub_date_str:
                        try:
                            pub_date = date.fromisoformat(pub_date_str)
                            if date_from and pub_date < date_from:
                                continue
                            if date_to and pub_date > date_to:
                                continue
                        except (ValueError, TypeError):
                            pass

                parsed.append(item)
            except Exception as e:
                logger.warning("Failed to parse Semantic Scholar paper", error=str(e))

        return parsed

    @staticmethod
    def _parse_paper(paper: dict[str, Any]) -> dict[str, Any] | None:
        """Parse a single paper object from the Semantic Scholar API."""
        paper_id = paper.get("paperId")
        if not paper_id:
            return None

        title = paper.get("title", "")
        abstract = paper.get("abstract") or ""
        venue = paper.get("venue") or ""
        year = paper.get("year")
        citation_count = paper.get("citationCount") or 0
        reference_count = paper.get("referenceCount") or 0
        fields_of_study = paper.get("fieldsOfStudy") or []
        publication_date = paper.get("publicationDate")
        url = paper.get("url")

        # Authors
        authors = []
        for author in paper.get("authors") or []:
            authors.append({
                "author_id": author.get("authorId", ""),
                "name": author.get("name", ""),
            })

        # External IDs
        external_ids = paper.get("externalIds") or {}

        # Open access PDF
        oa_pdf = paper.get("openAccessPdf")
        open_access_pdf_url = oa_pdf.get("url") if oa_pdf else None

        return {
            "paper_id": paper_id,
            "title": title,
            "abstract": abstract,
            "venue": venue,
            "year": year,
            "citation_count": citation_count,
            "reference_count": reference_count,
            "fields_of_study": fields_of_study,
            "authors": authors,
            "external_ids": external_ids,
            "open_access_pdf_url": open_access_pdf_url,
            "publication_date": publication_date,
            "url": url,
        }

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a parsed Semantic Scholar paper into a NormalizedPaper.

        Args:
            parsed_item: Dict from parse() representing one paper.

        Returns:
            NormalizedPaper instance.
        """
        paper_id = parsed_item.get("paper_id", "")
        title = parsed_item.get("title", "")
        abstract = parsed_item.get("abstract", "")
        external_ids = parsed_item.get("external_ids", {})

        doi = external_ids.get("DOI")
        pmid = external_ids.get("PubMed")

        # Parse publication date
        pub_date = self._parse_publication_date(
            parsed_item.get("publication_date"),
            parsed_item.get("year"),
        )

        content_hash = self.compute_content_hash(title, abstract)
        original_url = parsed_item.get("url")

        # Map authors to standard format (Semantic Scholar has single name field)
        authors = []
        for author in parsed_item.get("authors", []):
            authors.append({
                "given": "",
                "family": author.get("name", ""),
                "sequence": "",
                "affiliation": "",
                "orcid": None,
            })

        return NormalizedPaper(
            doi=doi,
            pmid=pmid,
            title=title,
            abstract=abstract or None,
            authors=authors,
            publication_date=pub_date,
            journal_or_origin=parsed_item.get("venue") or None,
            document_type="paper",
            language="en",
            original_url=original_url,
            raw_data={
                "source": "semantic_scholar",
                "source_id": paper_id,
                "citation_count": parsed_item.get("citation_count", 0),
                "reference_count": parsed_item.get("reference_count", 0),
                "fields_of_study": parsed_item.get("fields_of_study", []),
                "open_access_pdf_url": parsed_item.get("open_access_pdf_url"),
                "content_hash": content_hash,
            },
        )

    @staticmethod
    def _parse_publication_date(date_str: str | None, year: int | None) -> date | None:
        """Parse publication date from ISO string or fall back to year."""
        if date_str:
            try:
                return date.fromisoformat(date_str)
            except (ValueError, TypeError):
                pass
        if year:
            try:
                return date(year, 1, 1)
            except (ValueError, TypeError):
                pass
        return None

    @staticmethod
    def compute_content_hash(title: str, abstract: str) -> str:
        """Compute a SHA-256 hash of the paper content for deduplication."""
        content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
