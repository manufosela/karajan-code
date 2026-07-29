"""Unit tests for the arXiv connector."""

from __future__ import annotations

import hashlib
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx

from app.connectors.arxiv import ArXivConnector

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"


@pytest.fixture
def arxiv_xml() -> str:
    """Load arXiv Atom XML fixture."""
    return (FIXTURES_DIR / "arxiv_response.xml").read_text(encoding="utf-8")


@pytest.fixture
def connector() -> ArXivConnector:
    """Create an arXiv connector."""
    return ArXivConnector()


class TestArXivParseAtom:
    """Tests for parsing arXiv Atom XML responses."""

    def test_arxiv_parse_atom(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Parse fixture XML, verify 3 entries with correct fields."""
        raw_data = {"xml_parts": [arxiv_xml], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)

        assert len(entries) == 3

        # First entry
        e1 = entries[0]
        assert e1["arxiv_id"] == "2403.12345v1"
        assert "Deep Learning Framework" in e1["title"]
        assert "novel deep learning framework" in e1["abstract"]
        assert len(e1["authors"]) == 3
        assert e1["authors"][0]["name"] == "Li Zhang"
        assert e1["authors"][0]["affiliation"] == "Tsinghua University"
        assert e1["authors"][2]["name"] == "James Wilson"
        assert "affiliation" not in e1["authors"][2]
        assert "cs.CV" in e1["categories"]
        assert "cs.AI" in e1["categories"]
        assert "cs.LG" in e1["categories"]
        assert e1["published"] == "2024-03-14"
        assert e1["doi"] == "10.48550/arXiv.2403.12345"
        assert e1["pdf_url"] == "http://arxiv.org/pdf/2403.12345v1"

        # Second entry
        e2 = entries[1]
        assert e2["arxiv_id"] == "2403.09876v2"
        assert "CephaloNet" in e2["title"]
        assert e2["published"] == "2024-03-10"
        assert e2["doi"] is None

        # Third entry
        e3 = entries[2]
        assert e3["arxiv_id"] == "2403.05432v1"
        assert "Physics-Informed" in e3["title"]
        assert "q-bio.QM" in e3["categories"]

    def test_arxiv_parse_empty(self, connector: ArXivConnector) -> None:
        """Parsing empty XML parts returns empty list."""
        raw_data = {"xml_parts": [], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)
        assert entries == []

    def test_arxiv_parse_malformed_xml(self, connector: ArXivConnector) -> None:
        """Parsing malformed XML returns empty list without crashing."""
        raw_data = {"xml_parts": ["<broken>xml<"], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)
        assert entries == []


class TestArXivNormalize:
    """Tests for normalizing parsed arXiv data."""

    def test_arxiv_normalize(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Verify NormalizedPaper mapping from parsed data."""
        raw_data = {"xml_parts": [arxiv_xml], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)
        paper = connector.normalize(entries[0])

        assert paper.arxiv_id == "2403.12345v1"
        assert paper.doi == "10.48550/arXiv.2403.12345"
        assert "Deep Learning Framework" in paper.title
        assert paper.publication_date == date(2024, 3, 14)
        assert paper.journal_or_origin == "arXiv"
        assert paper.document_type == "preprint"
        assert paper.language == "en"
        assert paper.original_url == "https://arxiv.org/abs/2403.12345v1"
        assert len(paper.authors) == 3
        assert paper.authors[0]["name"] == "Li Zhang"
        assert paper.raw_data["source"] == "arxiv"
        assert paper.raw_data["source_id"] == "2403.12345v1"
        assert "cs.CV" in paper.raw_data["categories"]
        assert "cs.CV" in paper.raw_data["keywords"]
        assert paper.raw_data["pdf_url"] == "http://arxiv.org/pdf/2403.12345v1"
        assert "content_hash" in paper.raw_data


class TestArXivExtractId:
    """Tests for arXiv ID extraction from URLs."""

    def test_arxiv_extract_id_from_url(self) -> None:
        """Verify ID extraction from various URL formats."""
        assert ArXivConnector.extract_arxiv_id("http://arxiv.org/abs/2403.12345v1") == "2403.12345v1"
        assert ArXivConnector.extract_arxiv_id("http://arxiv.org/abs/2403.12345") == "2403.12345"
        assert ArXivConnector.extract_arxiv_id("http://arxiv.org/pdf/2403.09876v2") == "2403.09876v2"
        assert ArXivConnector.extract_arxiv_id("https://arxiv.org/abs/2301.00001v3") == "2301.00001v3"

    def test_arxiv_extract_id_invalid_url(self) -> None:
        """Verify None returned for URLs without valid arXiv IDs."""
        assert ArXivConnector.extract_arxiv_id("https://example.com/not-arxiv") is None
        assert ArXivConnector.extract_arxiv_id("") is None


class TestArXivPdfUrl:
    """Tests for PDF URL generation."""

    def test_arxiv_pdf_url(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Verify PDF URL generation in normalized papers."""
        raw_data = {"xml_parts": [arxiv_xml], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)

        # First entry has explicit PDF link in XML
        paper1 = connector.normalize(entries[0])
        assert paper1.raw_data["pdf_url"] == "http://arxiv.org/pdf/2403.12345v1"

        # All entries should have a PDF URL
        for entry in entries:
            paper = connector.normalize(entry)
            assert paper.raw_data["pdf_url"] is not None
            arxiv_id = entry["arxiv_id"]
            assert arxiv_id in paper.raw_data["pdf_url"]


class TestArXivContentHash:
    """Tests for content hash computation."""

    def test_arxiv_content_hash(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Verify hash computation is consistent."""
        raw_data = {"xml_parts": [arxiv_xml], "date_from": None, "date_to": None}
        entries = connector.parse(raw_data)
        paper = connector.normalize(entries[0])

        title = entries[0]["title"]
        abstract = entries[0]["abstract"]
        expected_content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        expected_hash = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()

        assert paper.raw_data["content_hash"] == expected_hash

    def test_arxiv_content_hash_deterministic(self) -> None:
        """Same inputs always produce same hash."""
        h1 = ArXivConnector.compute_content_hash("Title A", "Abstract A")
        h2 = ArXivConnector.compute_content_hash("Title A", "Abstract A")
        assert h1 == h2

        h3 = ArXivConnector.compute_content_hash("Title B", "Abstract A")
        assert h3 != h1


class TestArXivDeduplication:
    """Tests for deduplication of arXiv entries across multiple queries."""

    def test_arxiv_deduplication(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Duplicate entries from multiple query results are removed."""
        # Same XML provided twice (simulating two queries returning overlapping results)
        raw_data = {
            "xml_parts": [arxiv_xml, arxiv_xml],
            "date_from": None,
            "date_to": None,
        }
        entries = connector.parse(raw_data)

        # Should still be 3, not 6
        assert len(entries) == 3

        # Verify all unique IDs
        ids = [e["arxiv_id"] for e in entries]
        assert len(set(ids)) == 3


class TestArXivFetchMocked:
    """Tests for arXiv fetch with mocked HTTP requests."""

    @pytest.mark.asyncio
    async def test_arxiv_fetch_mocked(self, arxiv_xml: str) -> None:
        """Mock httpx, verify API call with correct parameters."""
        with respx.mock(base_url="http://export.arxiv.org/api/query") as respx_mock:
            # Mock the query endpoint
            query_route = respx_mock.get("").mock(return_value=httpx.Response(200, text=arxiv_xml))

            connector = ArXivConnector()
            try:
                result = await connector.fetch(
                    queries=["(cat:cs.AI) AND all:orthodontic"],
                    max_results=50,
                )

                # Verify the API was called
                assert query_route.called
                request = query_route.calls[0].request
                query_string = str(request.url.query)
                assert "sortBy=submittedDate" in query_string
                assert "sortOrder=descending" in query_string
                assert "max_results=50" in query_string

                # Verify result structure
                assert "xml_parts" in result
                assert len(result["xml_parts"]) == 1
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_arxiv_fetch_multiple_queries(self, arxiv_xml: str) -> None:
        """Multiple queries produce multiple xml_parts."""
        with respx.mock(base_url="http://export.arxiv.org/api/query") as respx_mock:
            respx_mock.get("").mock(return_value=httpx.Response(200, text=arxiv_xml))

            connector = ArXivConnector()
            try:
                result = await connector.fetch(
                    queries=["query1", "query2"],
                    max_results=50,
                )
                assert len(result["xml_parts"]) == 2
            finally:
                await connector.close()


class TestArXivDateFilter:
    """Tests for client-side date filtering."""

    def test_arxiv_date_filter(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Verify client-side date filter excludes entries outside range."""
        # Filter to only March 10-14 (should exclude entry from March 8)
        raw_data = {
            "xml_parts": [arxiv_xml],
            "date_from": "2024-03-10",
            "date_to": "2024-03-14",
        }
        entries = connector.parse(raw_data)

        # Entry 1: 2024-03-14 (included)
        # Entry 2: 2024-03-10 (included)
        # Entry 3: 2024-03-08 (excluded)
        assert len(entries) == 2
        ids = [e["arxiv_id"] for e in entries]
        assert "2403.12345v1" in ids
        assert "2403.09876v2" in ids
        assert "2403.05432v1" not in ids

    def test_arxiv_date_filter_no_dates(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Without date filter, all entries are returned."""
        raw_data = {
            "xml_parts": [arxiv_xml],
            "date_from": None,
            "date_to": None,
        }
        entries = connector.parse(raw_data)
        assert len(entries) == 3

    def test_arxiv_date_filter_narrow_range(self, connector: ArXivConnector, arxiv_xml: str) -> None:
        """Narrow date range filters correctly."""
        raw_data = {
            "xml_parts": [arxiv_xml],
            "date_from": "2024-03-14",
            "date_to": "2024-03-14",
        }
        entries = connector.parse(raw_data)
        assert len(entries) == 1
        assert entries[0]["arxiv_id"] == "2403.12345v1"
