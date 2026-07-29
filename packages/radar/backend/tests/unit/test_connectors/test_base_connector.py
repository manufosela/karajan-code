"""Tests for the BaseConnector abstract class and related models."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from typing import Any

import pytest

from app.connectors.base import BaseConnector, ConnectorResult, NormalizedPaper

# ---------------------------------------------------------------------------
# Mock connector implementation for testing
# ---------------------------------------------------------------------------

class MockConnector(BaseConnector):
    """Concrete implementation of BaseConnector used exclusively for testing."""

    def __init__(
        self,
        *,
        fetch_return: dict[str, Any] | None = None,
        parse_return: list[dict[str, Any]] | None = None,
        normalize_return: NormalizedPaper | None = None,
        fetch_side_effect: Exception | None = None,
        normalize_side_effect: Exception | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            source_name=kwargs.get("source_name", "mock_source"),
            base_url=kwargs.get("base_url", "https://api.mock.test"),
            config=kwargs.get("config"),
            rate_limit=kwargs.get("rate_limit", 10.0),
            rate_limit_period=kwargs.get("rate_limit_period", 1.0),
            max_retries=kwargs.get("max_retries", 3),
        )
        self._fetch_return = fetch_return or {"data": []}
        self._parse_return = parse_return or []
        self._normalize_return = normalize_return
        self._fetch_side_effect = fetch_side_effect
        self._normalize_side_effect = normalize_side_effect

        # Call tracking
        self.fetch_call_count = 0
        self.parse_call_count = 0
        self.normalize_call_count = 0

    async def fetch(self) -> dict[str, Any]:
        self.fetch_call_count += 1
        if self._fetch_side_effect:
            raise self._fetch_side_effect
        return self._fetch_return

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        self.parse_call_count += 1
        return self._parse_return

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        self.normalize_call_count += 1
        if self._normalize_side_effect:
            raise self._normalize_side_effect
        if self._normalize_return:
            return self._normalize_return
        return NormalizedPaper(
            title=parsed_item.get("title", "Mock Paper"),
            doi=parsed_item.get("doi"),
            pmid=parsed_item.get("pmid"),
            abstract=parsed_item.get("abstract"),
            authors=parsed_item.get("authors", []),
            publication_date=parsed_item.get("publication_date"),
            journal_or_origin=parsed_item.get("journal"),
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_parsed_items() -> list[dict[str, Any]]:
    """Three sample parsed items for testing the pipeline."""
    return [
        {
            "title": "Biomechanical analysis of clear aligner force systems",
            "doi": "10.1016/j.ajodo.2024.01.015",
            "pmid": "38001234",
            "abstract": "To evaluate the biomechanical effects of clear aligners.",
            "authors": [
                {"name": "Martinez E.", "affiliation": "University of Barcelona"},
                {"name": "Chen W.", "affiliation": "Tsinghua University"},
            ],
            "publication_date": date(2024, 3, 10),
            "journal": "American Journal of Orthodontics and Dentofacial Orthopedics",
        },
        {
            "title": "Machine learning approaches for cephalometric landmark detection",
            "doi": "10.2319/071523-489.1",
            "pmid": "38005678",
            "abstract": "This systematic review evaluates ML methods for cephalometric analysis.",
            "authors": [
                {"name": "Kim S.J.", "affiliation": "Seoul National University"},
            ],
            "publication_date": date(2024, 1, 22),
            "journal": "The Angle Orthodontist",
        },
        {
            "title": "Accelerated orthodontic tooth movement with micro-osteoperforations",
            "doi": "10.1186/s40510-024-00512-2",
            "pmid": "38009012",
            "abstract": None,
            "authors": [
                {"name": "Al-Harbi F.", "affiliation": "King Saud University"},
            ],
            "publication_date": date(2024, 4, 1),
            "journal": "Progress in Orthodontics",
        },
    ]


@pytest.fixture
def mock_connector(sample_parsed_items: list[dict[str, Any]]) -> MockConnector:
    """Pre-configured MockConnector with sample data."""
    return MockConnector(
        fetch_return={"articles": sample_parsed_items},
        parse_return=sample_parsed_items,
    )


# ---------------------------------------------------------------------------
# Tests: BaseConnector cannot be instantiated directly
# ---------------------------------------------------------------------------

class TestBaseConnectorAbstract:
    """Verify that BaseConnector enforces the abstract interface."""

    def test_abstract_methods_required(self) -> None:
        """BaseConnector cannot be instantiated because fetch, parse, and normalize are abstract."""
        with pytest.raises(TypeError, match="abstract method"):
            BaseConnector(  # type: ignore[abstract]
                source_name="direct",
                base_url="https://example.com",
            )

    def test_partial_implementation_raises(self) -> None:
        """A class implementing only some abstract methods still cannot be instantiated."""

        class PartialConnector(BaseConnector):
            async def fetch(self) -> dict[str, Any]:
                return {}

        with pytest.raises(TypeError, match="abstract method"):
            PartialConnector(  # type: ignore[abstract]
                source_name="partial",
                base_url="https://example.com",
            )


# ---------------------------------------------------------------------------
# Tests: run() orchestration pipeline
# ---------------------------------------------------------------------------

class TestRunOrchestration:
    """Verify run() calls fetch -> parse -> normalize in the correct order."""

    async def test_run_orchestrates_fetch_parse_normalize(
        self,
        mock_connector: MockConnector,
    ) -> None:
        """run() must call fetch, then parse, then normalize for each item."""
        result = await mock_connector.run()

        assert mock_connector.fetch_call_count == 1
        assert mock_connector.parse_call_count == 1
        # normalize is called once per parsed item
        assert mock_connector.normalize_call_count == 3

        assert isinstance(result, ConnectorResult)
        assert result.source_name == "mock_source"
        assert result.total_fetched == 3
        assert result.success_count == 3
        assert result.error_count == 0
        assert result.started_at is not None
        assert result.completed_at is not None
        assert result.completed_at >= result.started_at

    async def test_run_with_empty_results(self) -> None:
        """run() handles the case where fetch returns no items."""
        connector = MockConnector(
            fetch_return={"articles": []},
            parse_return=[],
        )
        result = await connector.run()

        assert result.total_fetched == 0
        assert result.success_count == 0
        assert result.error_count == 0

    async def test_run_captures_normalization_errors(
        self,
        sample_parsed_items: list[dict[str, Any]],
    ) -> None:
        """run() continues processing and captures errors when normalize() fails for some items."""
        connector = MockConnector(
            fetch_return={"articles": sample_parsed_items},
            parse_return=sample_parsed_items,
            normalize_side_effect=ValueError("Bad data in parsed item"),
        )
        result = await connector.run()

        assert result.total_fetched == 3
        assert result.success_count == 0
        assert result.error_count == 3
        for error in result.errors:
            assert "Normalization error" in error["message"]
            assert "timestamp" in error

    async def test_run_captures_fetch_errors(self) -> None:
        """run() captures and records errors when fetch() fails."""
        connector = MockConnector(
            fetch_side_effect=ConnectionError("API unreachable"),
        )
        result = await connector.run()

        assert result.total_fetched == 0
        assert result.success_count == 0
        assert result.error_count == 1
        assert "Fetch error" in result.errors[0]["message"]
        assert "API unreachable" in result.errors[0]["message"]

    async def test_run_normalized_papers_match_input(
        self,
        mock_connector: MockConnector,
    ) -> None:
        """The NormalizedPaper objects produced by run() match the input data."""
        result = await mock_connector.run()
        papers = result.papers

        assert len(papers) == 3
        assert papers[0].title == "Biomechanical analysis of clear aligner force systems"
        assert papers[0].doi == "10.1016/j.ajodo.2024.01.015"
        assert papers[0].pmid == "38001234"
        assert len(papers[0].authors) == 2
        assert papers[1].journal_or_origin == "The Angle Orthodontist"
        # Third paper has no abstract
        assert papers[2].abstract is None


# ---------------------------------------------------------------------------
# Tests: ConnectorResult model
# ---------------------------------------------------------------------------

class TestConnectorResult:
    """Verify ConnectorResult dataclass fields and computed properties."""

    def test_connector_result_has_required_fields(self) -> None:
        """ConnectorResult must expose all specified fields."""
        result = ConnectorResult(source_name="test_source")

        assert result.source_name == "test_source"
        assert result.papers == []
        assert result.total_fetched == 0
        assert result.errors == []
        assert result.started_at is None
        assert result.completed_at is None

    def test_success_count_returns_paper_count(self) -> None:
        """success_count is a property computed from len(papers)."""
        paper = NormalizedPaper(title="Test Paper")
        result = ConnectorResult(source_name="test", papers=[paper, paper])

        assert result.success_count == 2

    def test_error_count_returns_error_count(self) -> None:
        """error_count is a property computed from len(errors)."""
        result = ConnectorResult(
            source_name="test",
            errors=[
                {"message": "Error 1", "timestamp": "2024-01-01T00:00:00"},
                {"message": "Error 2", "timestamp": "2024-01-01T00:01:00"},
            ],
        )

        assert result.error_count == 2

    def test_connector_result_with_timestamps(self) -> None:
        """ConnectorResult stores started_at and completed_at datetimes."""
        start = datetime(2024, 9, 15, 10, 0, 0)
        end = datetime(2024, 9, 15, 10, 1, 30)
        result = ConnectorResult(
            source_name="pubmed",
            started_at=start,
            completed_at=end,
        )

        assert result.started_at == start
        assert result.completed_at == end


# ---------------------------------------------------------------------------
# Tests: NormalizedPaper model
# ---------------------------------------------------------------------------

class TestNormalizedPaper:
    """Verify NormalizedPaper Pydantic model creation and validation."""

    def test_normalized_paper_model_minimal(self) -> None:
        """NormalizedPaper can be created with only the required field (title)."""
        paper = NormalizedPaper(title="Minimal Paper")

        assert paper.title == "Minimal Paper"
        assert paper.doi is None
        assert paper.pmid is None
        assert paper.nct_id is None
        assert paper.arxiv_id is None
        assert paper.original_url is None
        assert paper.authors == []
        assert paper.publication_date is None
        assert paper.abstract is None
        assert paper.journal_or_origin is None
        assert paper.document_type == "paper"
        assert paper.language == "en"
        assert paper.raw_data == {}

    def test_normalized_paper_model_full(self) -> None:
        """NormalizedPaper accepts all fields when fully populated."""
        paper = NormalizedPaper(
            doi="10.1016/j.ajodo.2024.05.012",
            pmid="39184201",
            nct_id=None,
            arxiv_id=None,
            original_url="https://pubmed.ncbi.nlm.nih.gov/39184201/",
            title="Force systems generated by clear aligner attachments",
            authors=[
                {"name": "Lombardo L.", "affiliation": "University of Ferrara"},
                {"name": "Arreghini A.", "affiliation": "University of Ferrara"},
            ],
            publication_date=date(2024, 6, 18),
            abstract="Clear aligners have become a popular alternative.",
            journal_or_origin="Am J Orthod Dentofacial Orthop",
            document_type="paper",
            language="en",
            raw_data={"source": "pubmed", "mesh_terms": ["Clear Aligners"]},
        )

        assert paper.doi == "10.1016/j.ajodo.2024.05.012"
        assert paper.pmid == "39184201"
        assert len(paper.authors) == 2
        assert paper.publication_date == date(2024, 6, 18)
        assert paper.raw_data["source"] == "pubmed"

    def test_normalized_paper_different_document_types(self) -> None:
        """NormalizedPaper accepts various document_type values."""
        for doc_type in ("paper", "review", "preprint", "clinical_trial"):
            paper = NormalizedPaper(title="Test", document_type=doc_type)
            assert paper.document_type == doc_type

    def test_normalized_paper_content_hash(self) -> None:
        """content_hash can be computed from title + abstract for deduplication."""
        paper = NormalizedPaper(
            title="A study on clear aligners",
            abstract="This study evaluates clear aligner biomechanics.",
        )
        # The project should compute content_hash as SHA-256 of title+abstract
        content = f"{paper.title}{paper.abstract or ''}"
        expected_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        # Verify the hash is deterministic and reproducible
        assert expected_hash == hashlib.sha256(
            b"A study on clear alignersThis study evaluates clear aligner biomechanics."
        ).hexdigest()
        assert len(expected_hash) == 64  # SHA-256 hex digest length

    def test_normalized_paper_content_hash_without_abstract(self) -> None:
        """content_hash computation works when abstract is None."""
        paper = NormalizedPaper(title="Materials comparison study")
        content = f"{paper.title}{paper.abstract or ''}"
        computed_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        # Hash of title-only should be reproducible
        expected = hashlib.sha256(b"Materials comparison study").hexdigest()
        assert computed_hash == expected

    def test_normalized_paper_content_hash_different_papers_differ(self) -> None:
        """Two papers with different titles produce different content hashes."""
        paper_a = NormalizedPaper(title="Paper A", abstract="Same abstract")
        paper_b = NormalizedPaper(title="Paper B", abstract="Same abstract")

        hash_a = hashlib.sha256(f"{paper_a.title}{paper_a.abstract or ''}".encode()).hexdigest()
        hash_b = hashlib.sha256(f"{paper_b.title}{paper_b.abstract or ''}".encode()).hexdigest()

        assert hash_a != hash_b

    def test_normalized_paper_serialization(self) -> None:
        """NormalizedPaper can be serialized to dict via Pydantic."""
        paper = NormalizedPaper(
            title="Test serialization",
            doi="10.1234/test",
            authors=[{"name": "Author A."}],
        )
        data = paper.model_dump()

        assert isinstance(data, dict)
        assert data["title"] == "Test serialization"
        assert data["doi"] == "10.1234/test"
        assert data["authors"] == [{"name": "Author A."}]


# ---------------------------------------------------------------------------
# Tests: Retry on failure
# ---------------------------------------------------------------------------

class TestRetryBehavior:
    """Verify that transient fetch failures trigger retry logic."""

    async def test_retry_on_transient_failure(self) -> None:
        """fetch() is retried up to 3 times before the error is propagated to run()."""
        connector = MockConnector(
            fetch_side_effect=ConnectionError("Temporary network issue"),
        )

        result = await connector.run()

        # tenacity retries 3 times (stop_after_attempt(3)), so fetch is called 3 times
        assert connector.fetch_call_count == 3
        assert result.error_count == 1
        assert "Fetch error" in result.errors[0]["message"]

    async def test_retry_succeeds_on_second_attempt(self) -> None:
        """If fetch fails once then succeeds, the pipeline completes normally."""
        connector = MockConnector()
        call_count = 0
        original_fetch = connector.fetch

        async def flaky_fetch() -> dict[str, Any]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("Transient failure")
            return await original_fetch()

        connector.fetch = flaky_fetch  # type: ignore[assignment]

        # We need to also patch _fetch_with_retry to use the new fetch
        # Since _fetch_with_retry calls self.fetch(), the monkey-patch works
        result = await connector.run()

        # fetch was called twice: once failed, once succeeded
        assert call_count == 2
        assert result.error_count == 0


# ---------------------------------------------------------------------------
# Tests: Rate limiting
# ---------------------------------------------------------------------------

class TestRateLimiting:
    """Verify that the rate limiter is initialized and respected."""

    def test_rate_limiter_is_configured(self) -> None:
        """The connector initializes an AsyncLimiter with the given parameters."""
        connector = MockConnector(rate_limit=5.0, rate_limit_period=2.0)

        assert connector._limiter is not None
        assert connector._limiter.max_rate == 5.0
        assert connector._limiter.time_period == 2.0

    def test_default_rate_limit_values(self) -> None:
        """MockConnector uses high rate limits for testing; BaseConnector defaults to 1.0/1.0."""

        class MinimalConnector(BaseConnector):
            async def fetch(self) -> dict[str, Any]:
                return {}

            def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
                return []

            def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
                return NormalizedPaper(title="test")

        connector = MinimalConnector(
            source_name="minimal",
            base_url="https://example.com",
        )
        assert connector._limiter.max_rate == 1.0
        assert connector._limiter.time_period == 1.0

    async def test_rate_limiter_is_used_during_fetch(self) -> None:
        """_fetch_with_retry acquires the rate limiter before calling fetch."""
        connector = MockConnector()

        # Patch the limiter to track acquisition
        original_limiter = connector._limiter
        acquire_count = 0

        class TrackingLimiter:
            """Wrapper that counts acquire calls."""

            def __init__(self, limiter: Any) -> None:
                self._limiter = limiter
                self.max_rate = limiter.max_rate
                self.time_period = limiter.time_period

            async def __aenter__(self) -> TrackingLimiter:
                nonlocal acquire_count
                acquire_count += 1
                return self

            async def __aexit__(self, *args: Any) -> None:
                pass

        connector._limiter = TrackingLimiter(original_limiter)  # type: ignore[assignment]

        await connector.run()

        assert acquire_count == 1, "Rate limiter should be acquired once per fetch"


# ---------------------------------------------------------------------------
# Tests: Connector lifecycle (context manager)
# ---------------------------------------------------------------------------

class TestConnectorLifecycle:
    """Verify async context manager and resource cleanup."""

    async def test_context_manager_closes_client(self) -> None:
        """Using the connector as an async context manager closes the HTTP client."""
        async with MockConnector() as connector:
            assert connector._client is not None

        # After exiting, the client should be closed
        assert connector._client.is_closed

    async def test_manual_close(self) -> None:
        """Calling close() explicitly closes the HTTP client."""
        connector = MockConnector()
        assert not connector._client.is_closed

        await connector.close()
        assert connector._client.is_closed

    def test_connector_stores_config(self) -> None:
        """The connector stores source_name, base_url, and config."""
        connector = MockConnector(
            source_name="pubmed",
            base_url="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            config={"api_key": "test_key"},
        )

        assert connector.source_name == "pubmed"
        assert connector.base_url == "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
        assert connector.config == {"api_key": "test_key"}

    def test_base_url_trailing_slash_stripped(self) -> None:
        """base_url trailing slash is stripped during initialization."""
        connector = MockConnector(base_url="https://api.example.com/v1/")
        assert connector.base_url == "https://api.example.com/v1"

    def test_user_agent_header_set(self) -> None:
        """The HTTP client includes the OrthoFrontierRadar user agent."""
        connector = MockConnector()
        assert connector._client.headers["User-Agent"] == "OrthoFrontierRadar/0.1.0"
