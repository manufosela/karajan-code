"""arXiv connector using the arXiv API (Atom feed)."""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any

try:
    from defusedxml import ElementTree as ET  # noqa: N817
except ImportError:
    from xml.etree import ElementTree as ET  # type: ignore[no-redef]  # noqa: N817

from app.connectors.base import BaseConnector, NormalizedPaper
from app.core.logging import get_logger

logger = get_logger(__name__)

# arXiv API base URL
ARXIV_API_BASE_URL = "http://export.arxiv.org/api/query"

# Atom and arXiv namespaces
ATOM_NS = "http://www.w3.org/2005/Atom"
ARXIV_NS = "http://arxiv.org/schemas/atom"

# Default search queries for orthodontics-related AI/ML research
DEFAULT_QUERIES = [
    # AI/ML categories with dental/orthodontic terms
    (
        "(cat:cs.AI OR cat:cs.CV OR cat:cs.LG) AND "
        "(all:orthodontic OR all:dental OR all:aligner OR all:cephalometric OR all:tooth)"
    ),
    # Quantitative biology with dental/biomechanics terms
    (
        "cat:q-bio* AND "
        "(all:dental OR all:orthodontic OR all:biomechanics OR all:tooth OR all:aligner)"
    ),
]

# Regex to extract arXiv ID from URL
ARXIV_ID_PATTERN = re.compile(r"(?:abs|pdf)/(\d+\.\d+(?:v\d+)?)")


class ArXivConnector(BaseConnector):
    """Connector for fetching research papers from arXiv via the Atom API.

    Uses the arXiv API at http://export.arxiv.org/api/query.
    Rate limit: 1 request per 3 seconds (conservative, per arXiv guidelines).
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            source_name="arxiv",
            base_url=ARXIV_API_BASE_URL,
            config=config or {},
            rate_limit=1.0,
            rate_limit_period=3.0,
        )

    async def fetch(
        self,
        queries: list[str] | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        max_results: int = 100,
    ) -> dict[str, Any]:
        """Fetch articles from arXiv matching orthodontics/dental queries.

        Runs multiple queries and combines results. Date filtering is done
        client-side since arXiv API doesn't support date range parameters.

        Args:
            queries: List of search queries. Defaults to dental/orthodontic terms.
            date_from: Start date for client-side filtering.
            date_to: End date for client-side filtering.
            max_results: Maximum results per query.

        Returns:
            Dict with 'xml_parts' (list of XML strings), 'date_from', 'date_to'.
        """
        search_queries = queries or DEFAULT_QUERIES

        xml_parts: list[str] = []
        for query in search_queries:
            params: dict[str, Any] = {
                "search_query": query,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
                "max_results": max_results,
            }

            logger.info("Fetching from arXiv", query=query, max_results=max_results)
            async with self._limiter:
                response = await self._client.get("", params=params)
                response.raise_for_status()

            xml_parts.append(response.text)

        return {
            "xml_parts": xml_parts,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        }

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse arXiv Atom XML feed(s) into a list of entry dicts.

        Deduplicates entries across multiple query results by arXiv ID.

        Args:
            raw_data: Dict with 'xml_parts' containing list of XML strings.

        Returns:
            List of dicts, each representing a parsed arXiv entry.
        """
        xml_parts = raw_data.get("xml_parts", [])
        date_from_str = raw_data.get("date_from")
        date_to_str = raw_data.get("date_to")

        date_from = date.fromisoformat(date_from_str) if date_from_str else None
        date_to = date.fromisoformat(date_to_str) if date_to_str else None

        seen_ids: set[str] = set()
        entries: list[dict[str, Any]] = []

        for xml_string in xml_parts:
            if not xml_string or not xml_string.strip():
                continue

            try:
                root = ET.fromstring(xml_string)
            except ET.ParseError:
                logger.error("Failed to parse arXiv Atom XML")
                continue

            for entry in root.findall(f"{{{ATOM_NS}}}entry"):
                try:
                    parsed = self._parse_entry(entry)
                    if parsed is None:
                        continue

                    arxiv_id = parsed.get("arxiv_id", "")
                    if arxiv_id in seen_ids:
                        continue
                    seen_ids.add(arxiv_id)

                    # Client-side date filtering
                    if date_from or date_to:
                        pub_date_str = parsed.get("published")
                        if pub_date_str:
                            try:
                                pub_date = date.fromisoformat(pub_date_str)
                                if date_from and pub_date < date_from:
                                    continue
                                if date_to and pub_date > date_to:
                                    continue
                            except (ValueError, TypeError):
                                pass

                    entries.append(parsed)
                except Exception as e:
                    logger.warning("Failed to parse arXiv entry", error=str(e))

        return entries

    @staticmethod
    def _parse_entry(entry: Any) -> dict[str, Any] | None:
        """Parse a single Atom <entry> element."""
        # ID (arXiv URL like http://arxiv.org/abs/2403.12345v1)
        id_elem = entry.find(f"{{{ATOM_NS}}}id")
        if id_elem is None or not id_elem.text:
            return None

        full_id_url = id_elem.text.strip()
        arxiv_id = ArXivConnector.extract_arxiv_id(full_id_url)
        if not arxiv_id:
            return None

        # Title
        title_elem = entry.find(f"{{{ATOM_NS}}}title")
        title = ""
        if title_elem is not None and title_elem.text:
            # Clean up whitespace in title (arXiv titles often have line breaks)
            title = " ".join(title_elem.text.split())

        # Abstract (summary)
        summary_elem = entry.find(f"{{{ATOM_NS}}}summary")
        abstract = None
        if summary_elem is not None and summary_elem.text:
            abstract = " ".join(summary_elem.text.split())

        # Authors
        authors: list[dict[str, str]] = []
        for author_elem in entry.findall(f"{{{ATOM_NS}}}author"):
            name_elem = author_elem.find(f"{{{ATOM_NS}}}name")
            if name_elem is not None and name_elem.text:
                author_info: dict[str, str] = {"name": name_elem.text.strip()}
                # arXiv may include affiliation
                affil_elem = author_elem.find(f"{{{ARXIV_NS}}}affiliation")
                if affil_elem is not None and affil_elem.text:
                    author_info["affiliation"] = affil_elem.text.strip()
                authors.append(author_info)

        # Categories
        categories: list[str] = []
        for cat_elem in entry.findall(f"{{{ATOM_NS}}}category"):
            term = cat_elem.get("term")
            if term:
                categories.append(term)

        # Published date
        published_elem = entry.find(f"{{{ATOM_NS}}}published")
        published = None
        if published_elem is not None and published_elem.text:
            try:
                dt = datetime.fromisoformat(published_elem.text.replace("Z", "+00:00"))
                published = dt.date().isoformat()
            except (ValueError, TypeError):
                published = None

        # Updated date
        updated_elem = entry.find(f"{{{ATOM_NS}}}updated")
        updated = None
        if updated_elem is not None and updated_elem.text:
            try:
                dt = datetime.fromisoformat(updated_elem.text.replace("Z", "+00:00"))
                updated = dt.date().isoformat()
            except (ValueError, TypeError):
                updated = None

        # DOI (from arxiv:doi element)
        doi_elem = entry.find(f"{{{ARXIV_NS}}}doi")
        doi = None
        if doi_elem is not None and doi_elem.text:
            doi = doi_elem.text.strip()

        # PDF link
        pdf_url = None
        for link_elem in entry.findall(f"{{{ATOM_NS}}}link"):
            if link_elem.get("title") == "pdf":
                pdf_url = link_elem.get("href")
                break
        if not pdf_url:
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"

        return {
            "arxiv_id": arxiv_id,
            "title": title,
            "abstract": abstract,
            "authors": authors,
            "categories": categories,
            "published": published,
            "updated": updated,
            "doi": doi,
            "pdf_url": pdf_url,
            "full_id_url": full_id_url,
        }

    @staticmethod
    def extract_arxiv_id(url: str) -> str | None:
        """Extract the arXiv ID from a full arXiv URL.

        Examples:
            http://arxiv.org/abs/2403.12345v1 -> 2403.12345v1
            http://arxiv.org/abs/2403.12345 -> 2403.12345
        """
        match = ARXIV_ID_PATTERN.search(url)
        if match:
            return match.group(1)
        # Fallback: try to use the last path segment
        parts = url.rstrip("/").split("/")
        if parts:
            candidate = parts[-1]
            if re.match(r"\d+\.\d+", candidate):
                return candidate
        return None

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a parsed arXiv entry dict into a NormalizedPaper.

        Args:
            parsed_item: Dict from parse() representing one arXiv entry.

        Returns:
            NormalizedPaper instance.
        """
        arxiv_id = parsed_item.get("arxiv_id", "")
        title = parsed_item.get("title", "")
        abstract = parsed_item.get("abstract")

        # Parse publication date
        pub_date = None
        pub_date_str = parsed_item.get("published")
        if pub_date_str:
            try:
                pub_date = date.fromisoformat(pub_date_str)
            except (ValueError, TypeError):
                logger.warning("Could not parse arXiv date", arxiv_id=arxiv_id, date_str=pub_date_str)

        # Compute content hash
        content_hash = self.compute_content_hash(title, abstract or "")

        pdf_url = parsed_item.get("pdf_url", f"https://arxiv.org/pdf/{arxiv_id}")
        original_url = f"https://arxiv.org/abs/{arxiv_id}"

        return NormalizedPaper(
            doi=parsed_item.get("doi"),
            arxiv_id=arxiv_id,
            title=title,
            authors=parsed_item.get("authors", []),
            publication_date=pub_date,
            abstract=abstract,
            journal_or_origin="arXiv",
            document_type="preprint",
            language="en",
            original_url=original_url,
            raw_data={
                "source": "arxiv",
                "source_id": arxiv_id,
                "categories": parsed_item.get("categories", []),
                "keywords": parsed_item.get("categories", []),
                "pdf_url": pdf_url,
                "updated": parsed_item.get("updated"),
                "content_hash": content_hash,
            },
        )

    @staticmethod
    def compute_content_hash(title: str, abstract: str) -> str:
        """Compute a SHA-256 hash of the paper content for deduplication."""
        content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
