"""Unit tests for the ClinicalTrials.gov connector."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.connectors.clinical_trials import ClinicalTrialsConnector

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "fixtures"


@pytest.fixture
def ct_response() -> dict[str, Any]:
    """Load ClinicalTrials.gov JSON fixture."""
    text = (FIXTURES_DIR / "clinical_trials_response.json").read_text(encoding="utf-8")
    return json.loads(text)


@pytest.fixture
def connector() -> ClinicalTrialsConnector:
    """Create a ClinicalTrials.gov connector."""
    return ClinicalTrialsConnector()


class TestClinicalTrialsParseJSON:
    """Tests for parsing ClinicalTrials.gov v2 API JSON responses."""

    def test_parse_returns_all_studies(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Parse fixture JSON, verify 3 studies returned."""
        studies = connector.parse(ct_response)
        assert len(studies) == 3

    def test_parse_first_study_fields(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """First study has all expected parsed fields."""
        studies = connector.parse(ct_response)
        s1 = studies[0]

        assert s1["nct_id"] == "NCT06312148"
        assert "Clear Aligners Versus Fixed Braces" in s1["title"]
        assert "multicenter randomized controlled trial" in s1["brief_summary"]
        assert "Malocclusion, Angle Class II, Division 1" in s1["conditions"]
        assert s1["phase"] == "NA"
        assert s1["status"] == "RECRUITING"
        assert s1["enrollment"] == 120
        assert s1["sponsor"] == "University of Zurich"
        assert s1["start_date"] == "2024-03-15"
        assert s1["study_first_post_date"] == "2024-02-05"
        assert len(s1["interventions"]) == 2
        assert s1["interventions"][0]["name"] == "Invisalign Comprehensive Clear Aligners"
        assert s1["interventions"][0]["type"] == "DEVICE"

    def test_parse_second_study_completed(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Second study is completed with actual enrollment."""
        studies = connector.parse(ct_response)
        s2 = studies[1]

        assert s2["nct_id"] == "NCT06398201"
        assert "AI-Assisted Treatment Planning" in s2["title"]
        assert s2["status"] == "COMPLETED"
        assert s2["enrollment"] == 350

    def test_parse_third_study_minimal_fields(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Third study with minimal fields parses without error."""
        studies = connector.parse(ct_response)
        s3 = studies[2]

        assert s3["nct_id"] == "NCT05001234"
        assert "Accelerated Tooth Movement" in s3["title"]
        assert s3["status"] == "NOT_YET_RECRUITING"
        assert s3["phase"] == "PHASE1"
        # No enrollment info in minimal study design
        assert s3["enrollment"] is None or isinstance(s3["enrollment"], int)
        # No interventions in minimal study
        assert s3["interventions"] == []

    def test_parse_empty_studies(self, connector: ClinicalTrialsConnector) -> None:
        """Parsing response with empty studies returns empty list."""
        raw_data = {"studies": [], "totalCount": 0}
        studies = connector.parse(raw_data)
        assert studies == []

    def test_parse_missing_studies_key(self, connector: ClinicalTrialsConnector) -> None:
        """Parsing response without studies key returns empty list."""
        raw_data = {"totalCount": 0}
        studies = connector.parse(raw_data)
        assert studies == []


class TestClinicalTrialsNormalize:
    """Tests for normalizing parsed ClinicalTrials.gov data."""

    def test_normalize_full_study(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Verify NormalizedPaper mapping from first parsed study."""
        studies = connector.parse(ct_response)
        paper = connector.normalize(studies[0])

        assert paper.nct_id == "NCT06312148"
        assert "Clear Aligners Versus Fixed Braces" in paper.title
        assert "multicenter randomized controlled trial" in paper.abstract
        assert paper.publication_date == date(2024, 2, 5)
        assert paper.journal_or_origin == "ClinicalTrials.gov"
        assert paper.document_type == "clinical_trial"
        assert paper.language == "en"
        assert paper.original_url == "https://clinicaltrials.gov/study/NCT06312148"
        assert paper.doi is None
        assert paper.pmid is None
        assert paper.arxiv_id is None

        # raw_data fields
        assert paper.raw_data["source"] == "clinical_trials"
        assert paper.raw_data["source_id"] == "NCT06312148"
        assert "content_hash" in paper.raw_data
        assert paper.raw_data["status"] == "RECRUITING"
        assert paper.raw_data["phase"] == "NA"
        assert paper.raw_data["enrollment"] == 120
        assert paper.raw_data["sponsor"] == "University of Zurich"
        assert "Malocclusion, Angle Class II, Division 1" in paper.raw_data["conditions"]
        assert len(paper.raw_data["interventions"]) == 2
        assert paper.raw_data["interventions"][0]["name"] == "Invisalign Comprehensive Clear Aligners"

    def test_normalize_completed_study(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Completed study normalizes correctly with actual enrollment."""
        studies = connector.parse(ct_response)
        paper = connector.normalize(studies[1])

        assert paper.nct_id == "NCT06398201"
        assert paper.raw_data["status"] == "COMPLETED"
        assert paper.raw_data["enrollment"] == 350
        assert paper.publication_date == date(2023, 4, 18)

    def test_normalize_minimal_study(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Minimal study normalizes without error."""
        studies = connector.parse(ct_response)
        paper = connector.normalize(studies[2])

        assert paper.nct_id == "NCT05001234"
        assert paper.document_type == "clinical_trial"
        assert paper.original_url == "https://clinicaltrials.gov/study/NCT05001234"


class TestClinicalTrialsContentHash:
    """Tests for content hash computation."""

    def test_content_hash_present(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Content hash is present in normalized output."""
        studies = connector.parse(ct_response)
        paper = connector.normalize(studies[0])
        assert "content_hash" in paper.raw_data
        assert len(paper.raw_data["content_hash"]) == 64  # SHA-256 hex digest

    def test_content_hash_deterministic(self) -> None:
        """Same inputs produce same hash."""
        h1 = ClinicalTrialsConnector.compute_content_hash("Title A", "Summary A")
        h2 = ClinicalTrialsConnector.compute_content_hash("Title A", "Summary A")
        assert h1 == h2

    def test_content_hash_different_inputs(self) -> None:
        """Different inputs produce different hashes."""
        h1 = ClinicalTrialsConnector.compute_content_hash("Title A", "Summary A")
        h2 = ClinicalTrialsConnector.compute_content_hash("Title B", "Summary A")
        assert h1 != h2

    def test_content_hash_matches_expected(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Hash matches manual computation."""
        studies = connector.parse(ct_response)
        paper = connector.normalize(studies[0])

        title = studies[0]["title"]
        summary = studies[0]["brief_summary"]
        expected_content = f"{title.strip().lower()}|{summary.strip().lower()}"
        expected_hash = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()
        assert paper.raw_data["content_hash"] == expected_hash


class TestClinicalTrialsFetchMocked:
    """Tests for ClinicalTrials.gov fetch with mocked HTTP requests."""

    @pytest.mark.asyncio
    async def test_fetch_single_page(self, ct_response: dict[str, Any]) -> None:
        """Mock httpx, verify single-page fetch with correct parameters."""
        with respx.mock(base_url="https://clinicaltrials.gov/api/v2") as respx_mock:
            route = respx_mock.get("/studies").mock(return_value=httpx.Response(200, json=ct_response))

            connector = ClinicalTrialsConnector()
            try:
                result = await connector.fetch(max_results=10)

                assert route.called
                request = route.calls[0].request
                query_string = str(request.url.query)
                assert "pageSize=10" in query_string
                assert "format=json" in query_string

                assert "studies" in result
                assert len(result["studies"]) == 3
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_pagination(self) -> None:
        """Fetch handles nextPageToken pagination across multiple pages."""
        page1 = {
            "studies": [
                {
                    "protocolSection": {
                        "identificationModule": {"nctId": "NCT00000001", "briefTitle": "Study 1"},
                        "statusModule": {"overallStatus": "RECRUITING"},
                        "descriptionModule": {"briefSummary": "Summary 1"},
                    }
                }
            ],
            "totalCount": 2,
            "nextPageToken": "token_page2",
        }
        page2 = {
            "studies": [
                {
                    "protocolSection": {
                        "identificationModule": {"nctId": "NCT00000002", "briefTitle": "Study 2"},
                        "statusModule": {"overallStatus": "COMPLETED"},
                        "descriptionModule": {"briefSummary": "Summary 2"},
                    }
                }
            ],
            "totalCount": 2,
            "nextPageToken": None,
        }

        call_count = 0

        def side_effect(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            query = str(request.url.query)
            if "pageToken=token_page2" in query:
                return httpx.Response(200, json=page2)
            return httpx.Response(200, json=page1)

        with respx.mock(base_url="https://clinicaltrials.gov/api/v2") as respx_mock:
            respx_mock.get("/studies").mock(side_effect=side_effect)

            connector = ClinicalTrialsConnector()
            try:
                result = await connector.fetch(max_results=10)

                assert call_count == 2
                assert len(result["studies"]) == 2
                nct_ids = [s["protocolSection"]["identificationModule"]["nctId"] for s in result["studies"]]
                assert "NCT00000001" in nct_ids
                assert "NCT00000002" in nct_ids
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_with_date_range(self, ct_response: dict[str, Any]) -> None:
        """Fetch passes date range as query parameters."""
        with respx.mock(base_url="https://clinicaltrials.gov/api/v2") as respx_mock:
            route = respx_mock.get("/studies").mock(return_value=httpx.Response(200, json=ct_response))

            connector = ClinicalTrialsConnector()
            try:
                await connector.fetch(
                    date_from=date(2024, 1, 1),
                    date_to=date(2024, 12, 31),
                    max_results=50,
                )

                request = route.calls[0].request
                query_string = str(request.url.query)
                # ClinicalTrials.gov v2 uses MM/DD/YYYY format in filter.advanced
                assert "01%2F01%2F2024" in query_string
                assert "12%2F31%2F2024" in query_string
            finally:
                await connector.close()

    @pytest.mark.asyncio
    async def test_fetch_query_terms(self, ct_response: dict[str, Any]) -> None:
        """Verify default query terms are included in the request."""
        with respx.mock(base_url="https://clinicaltrials.gov/api/v2") as respx_mock:
            route = respx_mock.get("/studies").mock(return_value=httpx.Response(200, json=ct_response))

            connector = ClinicalTrialsConnector()
            try:
                await connector.fetch()

                request = route.calls[0].request
                query_string = str(request.url.query)
                # Should include orthodontic search terms
                assert "query.term" in query_string or "query.cond" in query_string
            finally:
                await connector.close()


class TestClinicalTrialsDateFilter:
    """Tests for client-side date filtering in parse."""

    def test_date_filter_excludes_old_studies(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Studies outside date range are excluded."""
        # Add date range to raw_data for client-side filtering
        ct_response["date_from"] = "2024-01-01"
        ct_response["date_to"] = "2024-04-30"
        studies = connector.parse(ct_response)

        # Study 1: first post 2024-02-05 (included)
        # Study 2: first post 2023-04-18 (excluded — before 2024-01-01)
        # Study 3: first post 2024-05-02 (excluded — after 2024-04-30)
        nct_ids = [s["nct_id"] for s in studies]
        assert "NCT06312148" in nct_ids
        assert "NCT06398201" not in nct_ids
        assert "NCT05001234" not in nct_ids

    def test_no_date_filter_returns_all(
        self, connector: ClinicalTrialsConnector, ct_response: dict[str, Any]
    ) -> None:
        """Without date filter, all studies are returned."""
        studies = connector.parse(ct_response)
        assert len(studies) == 3


class TestClinicalTrialsRegistry:
    """Tests for ClinicalTrials.gov connector registration."""

    def test_registered_in_default_registry(self) -> None:
        """clinical_trials is registered in the default registry."""
        from app.connectors.registry import default_registry

        assert "clinical_trials" in default_registry.registered_names

    def test_get_connector_from_registry(self) -> None:
        """Can instantiate ClinicalTrialsConnector from registry."""
        from app.connectors.registry import default_registry

        connector = default_registry.get("clinical_trials")
        assert isinstance(connector, ClinicalTrialsConnector)
        assert connector.source_name == "clinical_trials"
