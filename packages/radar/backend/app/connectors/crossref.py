"""Crossref connector for fetching orthodontic research papers."""

from __future__ import annotations

import hashlib
import re
from datetime import date, timedelta
from typing import Any

from app.connectors.base import BaseConnector, NormalizedPaper
from app.core.logging import get_logger
from app.profiles.active import default_query_for

logger = get_logger(__name__)

# Crossref API base URL
CROSSREF_API_BASE_URL = "https://api.crossref.org"


# Maximum rows per request (Crossref API limit)
MAX_ROWS = 1000

# Regex to strip JATS XML tags from abstracts
JATS_TAG_RE = re.compile(r"</?jats:[^>]+>")


class CrossrefConnector(BaseConnector):
    """Connector for fetching research papers from Crossref API.

    Uses cursor-based pagination and date range filtering.
    Rate limit: 1 request per second (polite pool without mailto).
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            source_name="crossref",
            base_url=CROSSREF_API_BASE_URL,
            config=config or {},
            rate_limit=1.0,
            rate_limit_period=1.0,
        )

    async def fetch(
        self,
        query: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        max_results: int = 100,
    ) -> dict[str, Any]:
        """Fetch works from Crossref matching orthodontics queries.

        Uses cursor-based pagination to accumulate all results.

        Args:
            query: Custom search query. Defaults to orthodontics-related terms.
            date_from: Start date for filtering (published date).
            date_to: End date for filtering (published date).
            max_results: Maximum number of results to fetch per page.

        Returns:
            Dict with 'items' list, 'total_results', 'date_from', 'date_to'.
        """
        if date_from is None:
            date_from = date.today() - timedelta(days=30)
        if date_to is None:
            date_to = date.today()

        search_query = query or default_query_for("crossref")
        rows = min(max_results, MAX_ROWS)

        params: dict[str, Any] = {
            "query": search_query,
            "rows": rows,
            "cursor": "*",
            "sort": "published",
            "order": "desc",
            "from-pub-date": date_from.isoformat(),
            "until-pub-date": date_to.isoformat(),
        }

        all_items: list[dict[str, Any]] = []
        previous_cursor: str | None = None

        while True:
            logger.info(
                "Fetching from Crossref",
                query=search_query,
                rows=rows,
                cursor=params.get("cursor"),
            )

            async with self._limiter:
                response = await self._client.get("/works", params=params)
                response.raise_for_status()

            data = response.json()
            message = data.get("message", {})
            items = message.get("items", [])

            if not items:
                break

            all_items.extend(items)

            next_cursor = message.get("next-cursor")
            if not next_cursor or next_cursor == previous_cursor:
                break

            previous_cursor = next_cursor
            params["cursor"] = next_cursor

        return {
            "items": all_items,
            "total_results": len(all_items),
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        }

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse Crossref API response into a list of work dicts.

        Args:
            raw_data: Dict with 'message.items' or top-level 'items'.

        Returns:
            List of dicts, each representing a parsed work.
        """
        # Support both raw API format and our fetch() output format
        message = raw_data.get("message", {})
        items = message.get("items", []) if message else []
        if not items:
            items = raw_data.get("items", [])

        date_from_str = raw_data.get("date_from")
        date_to_str = raw_data.get("date_to")
        date_from = date.fromisoformat(date_from_str) if date_from_str else None
        date_to = date.fromisoformat(date_to_str) if date_to_str else None

        parsed: list[dict[str, Any]] = []

        for item in items:
            try:
                work = self._parse_work(item)
                if work is None:
                    continue

                # Client-side date filtering
                if date_from or date_to:
                    pub_date = self._extract_date(item)
                    if pub_date:
                        if date_from and pub_date < date_from:
                            continue
                        if date_to and pub_date > date_to:
                            continue

                parsed.append(work)
            except Exception as e:
                logger.warning("Failed to parse Crossref work", error=str(e))

        return parsed

    @staticmethod
    def _parse_work(item: dict[str, Any]) -> dict[str, Any] | None:
        """Parse a single work object from the Crossref API."""
        doi = item.get("DOI")
        if not doi:
            return None

        titles = item.get("title", [])
        title = titles[0] if titles else ""

        # Strip JATS XML tags from abstract
        abstract_raw = item.get("abstract", "")
        abstract = JATS_TAG_RE.sub("", abstract_raw).strip() if abstract_raw else ""

        # Authors
        authors = []
        for author in item.get("author", []):
            affiliations = author.get("affiliation", [])
            affiliation = affiliations[0].get("name", "") if affiliations else ""
            authors.append(
                {
                    "given": author.get("given", ""),
                    "family": author.get("family", ""),
                    "sequence": author.get("sequence", ""),
                    "affiliation": affiliation,
                    "orcid": author.get("ORCID"),
                }
            )

        # Journal
        container_titles = item.get("container-title", [])
        journal = container_titles[0] if container_titles else ""

        # Publication date from "issued"
        issued = item.get("issued", {})
        date_parts = issued.get("date-parts", [[]])
        publication_date = _format_date_parts(date_parts[0]) if date_parts and date_parts[0] else ""

        return {
            "doi": doi,
            "title": title,
            "abstract": abstract,
            "authors": authors,
            "journal": journal,
            "publication_date": publication_date,
            "type": item.get("type", ""),
            "is_referenced_by_count": item.get("is-referenced-by-count", 0),
            "references_count": item.get("references-count", item.get("reference-count", 0)),
            "language": item.get("language", "en"),
            "url": item.get("URL", ""),
        }

    @staticmethod
    def _extract_date(item: dict[str, Any]) -> date | None:
        """Extract publication date from Crossref item for filtering."""
        issued = item.get("issued", {})
        date_parts = issued.get("date-parts", [[]])
        if not date_parts or not date_parts[0]:
            return None
        parts = date_parts[0]
        year = parts[0]
        month = parts[1] if len(parts) > 1 else 1
        day = parts[2] if len(parts) > 2 else 1
        try:
            return date(year, month, day)
        except (ValueError, TypeError):
            return None

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a parsed Crossref work into a NormalizedPaper.

        Args:
            parsed_item: Dict from parse() representing one work.

        Returns:
            NormalizedPaper instance.
        """
        doi = parsed_item.get("doi", "")
        title = parsed_item.get("title", "")
        abstract = parsed_item.get("abstract", "")

        # Parse publication date
        pub_date = self._parse_publication_date(parsed_item.get("publication_date", ""))

        content_hash = self.compute_content_hash(title, abstract)
        original_url = f"https://doi.org/{doi}" if doi else None

        return NormalizedPaper(
            doi=doi,
            title=title,
            abstract=abstract or None,
            authors=parsed_item.get("authors", []),
            publication_date=pub_date,
            journal_or_origin=parsed_item.get("journal") or None,
            document_type=parsed_item.get("type", "journal-article"),
            language=parsed_item.get("language", "en"),
            original_url=original_url,
            raw_data={
                "source": "crossref",
                "source_id": doi,
                "is_referenced_by_count": parsed_item.get("is_referenced_by_count", 0),
                "references_count": parsed_item.get("references_count", 0),
                "type": parsed_item.get("type", ""),
                "content_hash": content_hash,
            },
        )

    @staticmethod
    def _parse_publication_date(date_str: str) -> date | None:
        """Parse a date string like '2024-10' or '2024-10-15' into a date object."""
        if not date_str:
            return None
        parts = date_str.split("-")
        try:
            year = int(parts[0])
            month = int(parts[1]) if len(parts) > 1 else 1
            day = int(parts[2]) if len(parts) > 2 else 1
            return date(year, month, day)
        except (ValueError, IndexError, TypeError):
            return None

    @staticmethod
    def compute_content_hash(title: str, abstract: str) -> str:
        """Compute a SHA-256 hash of the work content for deduplication."""
        content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _format_date_parts(parts: list[int]) -> str:
    """Format Crossref date-parts [year, month?, day?] into a string."""
    if not parts:
        return ""
    if len(parts) == 1:
        return str(parts[0])
    if len(parts) == 2:
        return f"{parts[0]}-{parts[1]:02d}"
    return f"{parts[0]}-{parts[1]:02d}-{parts[2]:02d}"
