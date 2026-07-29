"""Unit tests for the Semantic Scholar connector."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.connectors.semantic_scholar import SemanticScholarConnector

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"


@pytest.fixture
def ss_response() -> dict[str, Any]:
    """Load Semantic Scholar JSON fixture."""
    text = (FIXTURES_DIR / "semantic_scholar_response.json").read_text(encoding="utf-8")
    return json.loads(text)


@pytest.fixture
def connector() -> SemanticScholarConnector:
    """Create a Semantic Scholar connector."""
    return SemanticScholarConnector()


class TestSemanticScholarParseJSON:
    """Tests for parsing Semantic Scholar API JSON responses."""

    def test_parse_returns_all_items(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Parse fixture JSON, verify 2 items returned."""
        items = connector.parse(ss_response)
        assert len(items) == 2

    def test_parse_first_item_fields(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """First item has all expected parsed fields."""
        items = connector.parse(ss_response)
        item = items[0]

        assert item["paper_id"] == "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
        assert "Machine learning-based prediction" in item["title"]
        assert "multi-center validation" in item["title"]
        assert "gradient-boosted ensemble" in item["abstract"]
        assert item["venue"] == "American Journal of Orthodontics and Dentofacial Orthopedics"
        assert item["year"] == 2024
        assert item["citation_count"] == 23
        assert item["reference_count"] == 56
        assert item["fields_of_study"] == ["Medicine", "Computer Science"]
        assert item["publication_date"] == "2024-06-15"

    def test_parse_authors(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Authors are parsed with name and authorId."""
        items = connector.parse(ss_response)
        authors = items[0]["authors"]

        assert len(authors) == 3
        assert authors[0]["name"] == "Hyeon-Shik Hwang"
        assert authors[0]["author_id"] == "145892301"
        assert authors[1]["name"] == "Sarah Mitchell"
        assert authors[2]["name"] == "Rodrigo Oyonarte"

    def test_parse_external_ids_doi_and_pubmed(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """External IDs include DOI and PubMed."""
        items = connector.parse(ss_response)
        ext_ids = items[0]["external_ids"]

        assert ext_ids["DOI"] == "10.1016/j.ajodo.2024.03.021"
        assert ext_ids["PubMed"] == "38912457"

    def test_parse_second_item_external_ids(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Second item has DOI, PubMed, and ArXiv external IDs."""
        items = connector.parse(ss_response)
        ext_ids = items[1]["external_ids"]

        assert ext_ids["DOI"] == "10.1007/s10856-024-06789-3"
        assert ext_ids["PubMed"] == "39056712"
        assert ext_ids.get("ArXiv") == "2402.11234"

    def test_parse_open_access_pdf(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Open access PDF URL is extracted when present."""
        items = connector.parse(ss_response)

        # First paper has no open access PDF
        assert items[0]["open_access_pdf_url"] is None

        # Second paper has open access PDF
        assert items[1]["open_access_pdf_url"] == "https://link.springer.com/content/pdf/10.1007/s10856-024-06789-3.pdf"

    def test_parse_second_item_fields(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Second item has correct fields."""
        items = connector.parse(ss_response)
        item = items[1]

        assert item["paper_id"] == "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1"
        assert "3D printing" in item["title"]
        assert item["citation_count"] == 8
        assert item["reference_count"] == 63
        assert item["year"] == 2024
        assert len(item["authors"]) == 2
        assert item["fields_of_study"] == ["Materials Science", "Medicine"]

    def test_parse_empty_data(self, connector: SemanticScholarConnector) -> None:
        """Parsing response with empty data returns empty list."""
        raw_data: dict[str, Any] = {"total": 0, "offset": 0, "data": []}
        items = connector.parse(raw_data)
        assert items == []

    def test_parse_missing_data_key(self, connector: SemanticScholarConnector) -> None:
        """Parsing response without data key returns empty list."""
        raw_data: dict[str, Any] = {"total": 0}
        items = connector.parse(raw_data)
        assert items == []

    def test_parse_missing_optional_fields(self, connector: SemanticScholarConnector) -> None:
        """Paper with missing optional fields is parsed with defaults."""
        raw_data: dict[str, Any] = {
            "total": 1,
            "data": [
                {
                    "paperId": "abc123",
                    "title": "Minimal Paper",
                }
            ],
        }
        items = connector.parse(raw_data)
        assert len(items) == 1
        item = items[0]
        assert item["paper_id"] == "abc123"
        assert item["title"] == "Minimal Paper"
        assert item["abstract"] == ""
        assert item["venue"] == ""
        assert item["year"] is None
        assert item["citation_count"] == 0
        assert item["reference_count"] == 0
        assert item["fields_of_study"] == []
        assert item["authors"] == []
        assert item["external_ids"] == {}
        assert item["open_access_pdf_url"] is None


class TestSemanticScholarNormalize:
    """Tests for normalizing parsed Semantic Scholar data."""

    def test_normalize_full_item(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Verify NormalizedPaper mapping from first parsed item."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[0])

        assert paper.doi == "10.1016/j.ajodo.2024.03.021"
        assert paper.pmid == "38912457"
        assert "Machine learning-based prediction" in paper.title
        assert "gradient-boosted ensemble" in paper.abstract
        assert paper.publication_date == date(2024, 6, 15)
        assert paper.journal_or_origin == "American Journal of Orthodontics and Dentofacial Orthopedics"
        assert paper.document_type == "paper"
        assert paper.language == "en"
        assert paper.original_url == "https://www.semanticscholar.org/paper/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
        assert paper.nct_id is None
        assert paper.arxiv_id is None

    def test_normalize_raw_data_fields(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """raw_data contains expected Semantic Scholar-specific fields."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[0])

        assert paper.raw_data["source"] == "semantic_scholar"
        assert paper.raw_data["source_id"] == "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
        assert paper.raw_data["citation_count"] == 23
        assert paper.raw_data["reference_count"] == 56
        assert paper.raw_data["fields_of_study"] == ["Medicine", "Computer Science"]
        assert paper.raw_data["open_access_pdf_url"] is None
        assert "content_hash" in paper.raw_data

    def test_normalize_second_item_with_open_access(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Second item normalizes correctly with open access PDF and arxiv_id."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[1])

        assert paper.doi == "10.1007/s10856-024-06789-3"
        assert paper.pmid == "39056712"
        assert paper.raw_data["open_access_pdf_url"] == "https://link.springer.com/content/pdf/10.1007/s10856-024-06789-3.pdf"
        assert paper.raw_data["citation_count"] == 8
        assert paper.raw_data["reference_count"] == 63

    def test_normalize_authors_format(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Authors are normalized into the standard format."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[0])

        assert len(paper.authors) == 3
        # Semantic Scholar has single "name" field; map to given/family
        assert paper.authors[0]["given"] == ""
        assert paper.authors[0]["family"] == "Hyeon-Shik Hwang"

    def test_normalize_year_only_date(self, connector: SemanticScholarConnector) -> None:
        """Paper with year-only publication date defaults to Jan 1."""
        parsed = {
            "paper_id": "test123",
            "title": "Test Paper",
            "abstract": "Test abstract",
            "venue": "Test Journal",
            "year": 2024,
            "citation_count": 0,
            "reference_count": 0,
            "fields_of_study": [],
            "authors": [],
            "external_ids": {},
            "open_access_pdf_url": None,
            "publication_date": None,
            "url": None,
        }
        paper = connector.normalize(parsed)
        assert paper.publication_date == date(2024, 1, 1)


class TestSemanticScholarContentHash:
    """Tests for content hash computation."""

    def test_content_hash_present(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Content hash is present in normalized output."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[0])
        assert "content_hash" in paper.raw_data
        assert len(paper.raw_data["content_hash"]) == 64  # SHA-256 hex digest

    def test_content_hash_deterministic(self) -> None:
        """Same inputs produce same hash."""
        h1 = SemanticScholarConnector.compute_content_hash("Title A", "Abstract A")
        h2 = SemanticScholarConnector.compute_content_hash("Title A", "Abstract A")
        assert h1 == h2

    def test_content_hash_different_inputs(self) -> None:
        """Different inputs produce different hashes."""
        h1 = SemanticScholarConnector.compute_content_hash("Title A", "Abstract A")
        h2 = SemanticScholarConnector.compute_content_hash("Title B", "Abstract A")
        assert h1 != h2

    def test_content_hash_matches_expected(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Hash matches manual computation."""
        items = connector.parse(ss_response)
        paper = connector.normalize(items[0])

        title = items[0]["title"]
        abstract = items[0]["abstract"]
        expected_content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        expected_hash = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()
        assert paper.raw_data["content_hash"] == expected_hash


class TestSemanticScholarFetchMocked:
    """Tests for Semantic Scholar fetch with mocked HTTP requests."""

    @pytest.mark.asyncio
    async def test_fetch_single_page(self, ss_response: dict[str, Any]) -> None:
        """Mock httpx, verify single-page fetch with correct parameters."""
        # Remove "next" to simulate a single-page response (no more pages)
        single_page = {**ss_response}
        single_page.pop("next", None)

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=single_page)
            )

            connector = SemanticScholarConnector()
            try:
                result = await connector.fetch(max_results=20)

                assert route.called
                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "limit=20" in query_string
                assert "offset=0" in query_string
                assert "fields=" in query_string

                assert "data" in result
                assert len(result["data"]) == 2
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_offset_pagination(self) -> None:
        """Fetch handles offset-based pagination across multiple pages."""
        page1_response = {
            "total": 3,
            "offset": 0,
            "next": 2,
            "data": [
                {"paperId": "paper1", "title": "Paper 1"},
                {"paperId": "paper2", "title": "Paper 2"},
            ],
        }
        page2_response = {
            "total": 3,
            "offset": 2,
            "data": [
                {"paperId": "paper3", "title": "Paper 3"},
            ],
        }

        call_count = 0

        def side_effect(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            query = str(request.url.query)
            if "offset=2" in query:
                return httpx.Response(200, json=page2_response)
            return httpx.Response(200, json=page1_response)

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            respx_mock.get("/paper/search").mock(side_effect=side_effect)

            connector = SemanticScholarConnector()
            try:
                result = await connector.fetch(max_results=2)

                assert call_count == 2
                assert len(result["data"]) == 3
                paper_ids = [p["paperId"] for p in result["data"]]
                assert "paper1" in paper_ids
                assert "paper2" in paper_ids
                assert "paper3" in paper_ids
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_date_range(self, ss_response: dict[str, Any]) -> None:
        """Fetch passes year range as filter parameter."""
        single_page = {**ss_response}
        single_page.pop("next", None)

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=single_page)
            )

            connector = SemanticScholarConnector()
            try:
                await connector.fetch(
                    date_from=date(2024, 1, 1),
                    date_to=date(2024, 12, 31),
                )

                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "year=2024-2024" in query_string
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_date_range_spanning_years(self, ss_response: dict[str, Any]) -> None:
        """Fetch passes year range spanning multiple years."""
        single_page = {**ss_response}
        single_page.pop("next", None)

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=single_page)
            )

            connector = SemanticScholarConnector()
            try:
                await connector.fetch(
                    date_from=date(2023, 6, 1),
                    date_to=date(2024, 3, 15),
                )

                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "year=2023-2024" in query_string
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_stops_when_no_next(self) -> None:
        """Fetch stops paginating when response has no 'next' field."""
        response = {
            "total": 1,
            "offset": 0,
            "data": [
                {"paperId": "paper1", "title": "Paper 1"},
            ],
        }

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=response)
            )

            connector = SemanticScholarConnector()
            try:
                result = await connector.fetch(max_results=10)

                assert route.call_count == 1
                assert len(result["data"]) == 1
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_stops_on_empty_data(self) -> None:
        """Fetch stops paginating when data array is empty."""
        response: dict[str, Any] = {
            "total": 0,
            "offset": 0,
            "data": [],
        }

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=response)
            )

            connector = SemanticScholarConnector()
            try:
                result = await connector.fetch(max_results=10)

                assert route.call_count == 1
                assert len(result["data"]) == 0
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_default_query(self, ss_response: dict[str, Any]) -> None:
        """Verify default query terms are included in the request."""
        single_page = {**ss_response}
        single_page.pop("next", None)

        with respx.mock(base_url="https://api.semanticscholar.org/graph/v1") as respx_mock:
            route = respx_mock.get("/paper/search").mock(
                return_value=httpx.Response(200, json=single_page)
            )

            connector = SemanticScholarConnector()
            try:
                await connector.fetch()

                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "query=" in query_string
            finally:
                await connector.close()


class TestSemanticScholarDateFilter:
    """Tests for client-side date filtering in parse."""

    def test_date_filter_excludes_items(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Items outside date range are excluded."""
        ss_response["date_from"] = "2024-07-01"
        ss_response["date_to"] = "2024-12-31"
        items = connector.parse(ss_response)

        # Item 1: publicationDate 2024-06-15 (excluded — before 2024-07-01)
        # Item 2: publicationDate 2024-07-22 (included)
        paper_ids = [i["paper_id"] for i in items]
        assert "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" not in paper_ids
        assert "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1" in paper_ids

    def test_no_date_filter_returns_all(
        self, connector: SemanticScholarConnector, ss_response: dict[str, Any]
    ) -> None:
        """Without date filter, all items are returned."""
        items = connector.parse(ss_response)
        assert len(items) == 2


class TestSemanticScholarRegistry:
    """Tests for Semantic Scholar connector registration."""

    def test_registered_in_default_registry(self) -> None:
        """semantic_scholar is registered in the default registry."""
        from app.connectors.registry import default_registry

        assert "semantic_scholar" in default_registry.registered_names

    def test_get_connector_from_registry(self) -> None:
        """Can instantiate SemanticScholarConnector from registry."""
        from app.connectors.registry import default_registry

        connector = default_registry.get("semantic_scholar")
        assert isinstance(connector, SemanticScholarConnector)
        assert connector.source_name == "semantic_scholar"
