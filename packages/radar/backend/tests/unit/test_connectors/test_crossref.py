"""Unit tests for the Crossref connector."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.connectors.crossref import CrossrefConnector

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"


@pytest.fixture
def crossref_response() -> dict[str, Any]:
    """Load Crossref JSON fixture."""
    text = (FIXTURES_DIR / "crossref_response.json").read_text(encoding="utf-8")
    return json.loads(text)


@pytest.fixture
def connector() -> CrossrefConnector:
    """Create a Crossref connector."""
    return CrossrefConnector()


class TestCrossrefParseJSON:
    """Tests for parsing Crossref API JSON responses."""

    def test_parse_returns_all_items(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Parse fixture JSON, verify 2 items returned."""
        items = connector.parse(crossref_response)
        assert len(items) == 2

    def test_parse_first_item_fields(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """First item has all expected parsed fields."""
        items = connector.parse(crossref_response)
        item = items[0]

        assert item["doi"] == "10.1016/j.ajodo.2024.06.015"
        assert "Biomechanical effects of attachment design" in item["title"]
        assert "clear aligner treatment" in item["abstract"]
        assert len(item["authors"]) == 3
        assert item["authors"][0]["given"] == "Laura"
        assert item["authors"][0]["family"] == "Cassetta"
        assert item["journal"] == "American Journal of Orthodontics and Dentofacial Orthopedics"
        assert item["type"] == "journal-article"
        assert item["is_referenced_by_count"] == 7
        assert item["references_count"] == 42
        assert item["publication_date"] == "2024-10"

    def test_parse_second_item_fields(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Second item has correct fields."""
        items = connector.parse(crossref_response)
        item = items[1]

        assert item["doi"] == "10.1016/j.ajodo.2024.08.003"
        assert "Digital orthodontics" in item["title"]
        assert len(item["authors"]) == 2
        assert item["authors"][0]["family"] == "Vaid"
        assert item["is_referenced_by_count"] == 12
        assert item["references_count"] == 87

    def test_parse_strips_jats_tags_from_abstract(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Abstract has JATS XML tags stripped."""
        items = connector.parse(crossref_response)
        item = items[0]

        assert "<jats:" not in item["abstract"]
        assert "</jats:" not in item["abstract"]
        # Content should still be present
        assert "systematic review and meta-analysis" in item["abstract"]

    def test_parse_empty_items(self, connector: CrossrefConnector) -> None:
        """Parsing response with empty items returns empty list."""
        raw_data = {"message": {"items": [], "total-results": 0}}
        items = connector.parse(raw_data)
        assert items == []

    def test_parse_missing_message_key(self, connector: CrossrefConnector) -> None:
        """Parsing response without message key returns empty list."""
        raw_data = {"status": "ok"}
        items = connector.parse(raw_data)
        assert items == []

    def test_parse_author_with_orcid(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Authors with ORCID have it included."""
        items = connector.parse(crossref_response)
        first_author = items[0]["authors"][0]
        assert first_author["orcid"] == "https://orcid.org/0000-0002-4567-8901"

    def test_parse_author_without_orcid(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Authors without ORCID have None."""
        items = connector.parse(crossref_response)
        second_author = items[0]["authors"][1]
        assert second_author.get("orcid") is None

    def test_parse_author_affiliations(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Author affiliations are extracted."""
        items = connector.parse(crossref_response)
        first_author = items[0]["authors"][0]
        assert "Sapienza University of Rome" in first_author["affiliation"]


class TestCrossrefNormalize:
    """Tests for normalizing parsed Crossref data."""

    def test_normalize_full_item(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Verify NormalizedPaper mapping from first parsed item."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])

        assert paper.doi == "10.1016/j.ajodo.2024.06.015"
        assert "Biomechanical effects" in paper.title
        assert "systematic review and meta-analysis" in paper.abstract
        assert paper.publication_date == date(2024, 10, 1)
        assert paper.journal_or_origin == "American Journal of Orthodontics and Dentofacial Orthopedics"
        assert paper.document_type == "journal-article"
        assert paper.language == "en"
        assert paper.original_url == "https://doi.org/10.1016/j.ajodo.2024.06.015"
        assert paper.pmid is None
        assert paper.nct_id is None
        assert paper.arxiv_id is None

    def test_normalize_raw_data_fields(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """raw_data contains expected fields."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])

        assert paper.raw_data["source"] == "crossref"
        assert paper.raw_data["source_id"] == "10.1016/j.ajodo.2024.06.015"
        assert paper.raw_data["is_referenced_by_count"] == 7
        assert paper.raw_data["references_count"] == 42
        assert paper.raw_data["type"] == "journal-article"
        assert "content_hash" in paper.raw_data

    def test_normalize_authors_format(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Authors are normalized into proper format."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])

        assert len(paper.authors) == 3
        assert paper.authors[0]["given"] == "Laura"
        assert paper.authors[0]["family"] == "Cassetta"

    def test_normalize_second_item(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Second item normalizes correctly."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[1])

        assert paper.doi == "10.1016/j.ajodo.2024.08.003"
        assert paper.raw_data["is_referenced_by_count"] == 12
        assert paper.raw_data["references_count"] == 87

    def test_normalize_partial_date(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Partial dates (year+month only) are handled by defaulting day to 1."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])
        # issued date is [2024, 10] -> 2024-10-01
        assert paper.publication_date == date(2024, 10, 1)


class TestCrossrefContentHash:
    """Tests for content hash computation."""

    def test_content_hash_present(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Content hash is present in normalized output."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])
        assert "content_hash" in paper.raw_data
        assert len(paper.raw_data["content_hash"]) == 64  # SHA-256 hex digest

    def test_content_hash_deterministic(self) -> None:
        """Same inputs produce same hash."""
        h1 = CrossrefConnector.compute_content_hash("Title A", "Abstract A")
        h2 = CrossrefConnector.compute_content_hash("Title A", "Abstract A")
        assert h1 == h2

    def test_content_hash_different_inputs(self) -> None:
        """Different inputs produce different hashes."""
        h1 = CrossrefConnector.compute_content_hash("Title A", "Abstract A")
        h2 = CrossrefConnector.compute_content_hash("Title B", "Abstract A")
        assert h1 != h2

    def test_content_hash_matches_expected(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Hash matches manual computation."""
        items = connector.parse(crossref_response)
        paper = connector.normalize(items[0])

        title = items[0]["title"]
        abstract = items[0]["abstract"]
        expected_content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        expected_hash = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()
        assert paper.raw_data["content_hash"] == expected_hash


class TestCrossrefFetchMocked:
    """Tests for Crossref fetch with mocked HTTP requests."""

    @pytest.mark.asyncio
    async def test_fetch_single_page(self, crossref_response: dict[str, Any]) -> None:
        """Mock httpx, verify single-page fetch with correct parameters."""
        with respx.mock(base_url="https://api.crossref.org") as respx_mock:
            route = respx_mock.get("/works").mock(return_value=httpx.Response(200, json=crossref_response))

            connector = CrossrefConnector()
            try:
                result = await connector.fetch(max_results=20)

                assert route.called
                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "rows=20" in query_string

                assert "items" in result
                assert len(result["items"]) == 2
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_cursor_pagination(self) -> None:
        """Fetch handles cursor-based pagination across multiple pages."""
        page1_response = {
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "total-results": 2,
                "items": [
                    {
                        "DOI": "10.1000/test1",
                        "title": ["Test Paper 1"],
                        "type": "journal-article",
                    }
                ],
                "next-cursor": "cursor_page2",
                "items-per-page": 1,
            },
        }
        page2_response = {
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "total-results": 2,
                "items": [
                    {
                        "DOI": "10.1000/test2",
                        "title": ["Test Paper 2"],
                        "type": "journal-article",
                    }
                ],
                "next-cursor": "cursor_page2",  # same cursor = no more results
                "items-per-page": 1,
            },
        }

        call_count = 0

        def side_effect(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            query = str(request.url.query)
            if "cursor=cursor_page2" in query:
                return httpx.Response(200, json=page2_response)
            return httpx.Response(200, json=page1_response)

        with respx.mock(base_url="https://api.crossref.org") as respx_mock:
            respx_mock.get("/works").mock(side_effect=side_effect)

            connector = CrossrefConnector()
            try:
                result = await connector.fetch(max_results=2)

                assert call_count == 2
                assert len(result["items"]) == 2
                dois = [item["DOI"] for item in result["items"]]
                assert "10.1000/test1" in dois
                assert "10.1000/test2" in dois
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_date_range(self, crossref_response: dict[str, Any]) -> None:
        """Fetch passes date range as filter parameters."""
        with respx.mock(base_url="https://api.crossref.org") as respx_mock:
            route = respx_mock.get("/works").mock(return_value=httpx.Response(200, json=crossref_response))

            connector = CrossrefConnector()
            try:
                await connector.fetch(
                    date_from=date(2024, 1, 1),
                    date_to=date(2024, 12, 31),
                )

                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "from-pub-date=2024-01-01" in query_string
                assert "until-pub-date=2024-12-31" in query_string
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_default_query(self, crossref_response: dict[str, Any]) -> None:
        """Verify default query terms are included in the request."""
        with respx.mock(base_url="https://api.crossref.org") as respx_mock:
            route = respx_mock.get("/works").mock(return_value=httpx.Response(200, json=crossref_response))

            connector = CrossrefConnector()
            try:
                await connector.fetch()

                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "query=" in query_string
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_stops_when_no_new_items(self) -> None:
        """Fetch stops paginating when page returns empty items."""
        page1_response = {
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "total-results": 1,
                "items": [
                    {
                        "DOI": "10.1000/test1",
                        "title": ["Test Paper 1"],
                        "type": "journal-article",
                    }
                ],
                "next-cursor": "cursor_page2",
                "items-per-page": 1,
            },
        }
        page2_response = {
            "status": "ok",
            "message-type": "work-list",
            "message": {
                "total-results": 1,
                "items": [],
                "next-cursor": "cursor_page3",
                "items-per-page": 1,
            },
        }

        call_count = 0

        def side_effect(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            query = str(request.url.query)
            if "cursor=cursor_page2" in query:
                return httpx.Response(200, json=page2_response)
            return httpx.Response(200, json=page1_response)

        with respx.mock(base_url="https://api.crossref.org") as respx_mock:
            respx_mock.get("/works").mock(side_effect=side_effect)

            connector = CrossrefConnector()
            try:
                result = await connector.fetch(max_results=10)

                assert call_count == 2
                assert len(result["items"]) == 1
            finally:
                await connector.close()


class TestCrossrefDateFilter:
    """Tests for client-side date filtering in parse."""

    def test_date_filter_excludes_items(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Items outside date range are excluded."""
        crossref_response["date_from"] = "2024-09-01"
        crossref_response["date_to"] = "2024-12-31"
        items = connector.parse(crossref_response)

        # Item 1: issued 2024-10 (included)
        # Item 2: issued 2024-08 (excluded — before 2024-09-01)
        dois = [i["doi"] for i in items]
        assert "10.1016/j.ajodo.2024.06.015" in dois
        assert "10.1016/j.ajodo.2024.08.003" not in dois

    def test_no_date_filter_returns_all(
        self, connector: CrossrefConnector, crossref_response: dict[str, Any]
    ) -> None:
        """Without date filter, all items are returned."""
        items = connector.parse(crossref_response)
        assert len(items) == 2


class TestCrossrefRegistry:
    """Tests for Crossref connector registration."""

    def test_registered_in_default_registry(self) -> None:
        """crossref is registered in the default registry."""
        from app.connectors.registry import default_registry

        assert "crossref" in default_registry.registered_names

    def test_get_connector_from_registry(self) -> None:
        """Can instantiate CrossrefConnector from registry."""
        from app.connectors.registry import default_registry

        connector = default_registry.get("crossref")
        assert isinstance(connector, CrossrefConnector)
        assert connector.source_name == "crossref"
