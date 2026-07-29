"""ClinicalTrials.gov connector using the v2 API (JSON)."""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any

from app.connectors.base import BaseConnector, NormalizedPaper
from app.core.logging import get_logger
from app.profiles.active import default_query_for

logger = get_logger(__name__)

# ClinicalTrials.gov v2 API base URL
CT_API_BASE_URL = "https://clinicaltrials.gov/api/v2"


# Maximum page size allowed by the API
MAX_PAGE_SIZE = 1000


class ClinicalTrialsConnector(BaseConnector):
    """Connector for fetching clinical trials from ClinicalTrials.gov v2 API.

    Uses JSON responses with nextPageToken pagination.
    Rate limit: 1 request per second (conservative).
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            source_name="clinical_trials",
            base_url=CT_API_BASE_URL,
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
        """Fetch clinical trials from ClinicalTrials.gov matching orthodontics queries.

        Handles nextPageToken pagination, accumulating all studies.

        Args:
            query: Custom search query. Defaults to orthodontics-related terms.
            date_from: Start date for filtering (studyFirstPostDate).
            date_to: End date for filtering (studyFirstPostDate).
            max_results: Maximum number of results to fetch per page.

        Returns:
            Dict with 'studies' list, 'totalCount', 'date_from', 'date_to'.
        """
        if date_from is None:
            date_from = date.today() - timedelta(days=30)
        if date_to is None:
            date_to = date.today()

        search_query = query or default_query_for("clinical_trials")
        page_size = min(max_results, MAX_PAGE_SIZE)

        params: dict[str, Any] = {
            "query.term": search_query,
            "format": "json",
            "pageSize": page_size,
            "filter.advanced": f"AREA[StudyFirstPostDate]RANGE[{date_from:%m/%d/%Y},{date_to:%m/%d/%Y}]",
        }

        all_studies: list[dict[str, Any]] = []
        page_token: str | None = None

        while True:
            if page_token:
                params["pageToken"] = page_token
            elif "pageToken" in params:
                del params["pageToken"]

            logger.info(
                "Fetching from ClinicalTrials.gov",
                query=search_query,
                page_size=page_size,
                page_token=page_token,
            )

            async with self._limiter:
                response = await self._client.get("/studies", params=params)
                response.raise_for_status()

            data = response.json()
            studies = data.get("studies", [])
            all_studies.extend(studies)

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return {
            "studies": all_studies,
            "totalCount": len(all_studies),
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        }

    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse ClinicalTrials.gov JSON response into a list of study dicts.

        Args:
            raw_data: Dict with 'studies' containing the list of study objects.

        Returns:
            List of dicts, each representing a parsed clinical trial.
        """
        studies = raw_data.get("studies", [])
        date_from_str = raw_data.get("date_from")
        date_to_str = raw_data.get("date_to")

        date_from = date.fromisoformat(date_from_str) if date_from_str else None
        date_to = date.fromisoformat(date_to_str) if date_to_str else None

        parsed: list[dict[str, Any]] = []

        for study in studies:
            try:
                item = self._parse_study(study)
                if item is None:
                    continue

                # Client-side date filtering
                if date_from or date_to:
                    post_date_str = item.get("study_first_post_date")
                    if post_date_str:
                        try:
                            post_date = date.fromisoformat(post_date_str)
                            if date_from and post_date < date_from:
                                continue
                            if date_to and post_date > date_to:
                                continue
                        except (ValueError, TypeError):
                            pass

                parsed.append(item)
            except Exception as e:
                logger.warning("Failed to parse ClinicalTrials.gov study", error=str(e))

        return parsed

    @staticmethod
    def _parse_study(study: dict[str, Any]) -> dict[str, Any] | None:
        """Parse a single study object from the v2 API."""
        protocol = study.get("protocolSection", {})

        # Identification
        id_module = protocol.get("identificationModule", {})
        nct_id = id_module.get("nctId")
        if not nct_id:
            return None

        title = id_module.get("briefTitle", "")

        # Status
        status_module = protocol.get("statusModule", {})
        status = status_module.get("overallStatus", "")
        start_date_struct = status_module.get("startDateStruct", {})
        start_date = start_date_struct.get("date")
        first_post_struct = status_module.get("studyFirstPostDateStruct", {})
        study_first_post_date = first_post_struct.get("date")

        # Description
        desc_module = protocol.get("descriptionModule", {})
        brief_summary = desc_module.get("briefSummary", "")

        # Conditions
        cond_module = protocol.get("conditionsModule", {})
        conditions = cond_module.get("conditions", [])
        keywords = cond_module.get("keywords", [])

        # Design / Phase / Enrollment
        design_module = protocol.get("designModule", {})
        phases = design_module.get("phases", [])
        phase = phases[0] if phases else None
        enrollment_info = design_module.get("enrollmentInfo", {})
        enrollment = enrollment_info.get("count") if enrollment_info else None

        # Interventions
        arms_module = protocol.get("armsInterventionsModule", {})
        raw_interventions = arms_module.get("interventions", [])
        interventions = [
            {"type": iv.get("type", ""), "name": iv.get("name", ""), "description": iv.get("description", "")}
            for iv in raw_interventions
        ]

        # Sponsor
        sponsor_module = protocol.get("sponsorCollaboratorsModule", {})
        lead_sponsor = sponsor_module.get("leadSponsor", {})
        sponsor = lead_sponsor.get("name", "")

        return {
            "nct_id": nct_id,
            "title": title,
            "brief_summary": brief_summary,
            "conditions": conditions,
            "keywords": keywords,
            "interventions": interventions,
            "phase": phase,
            "status": status,
            "enrollment": enrollment,
            "sponsor": sponsor,
            "start_date": start_date,
            "study_first_post_date": study_first_post_date,
        }

    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a parsed clinical trial into a NormalizedPaper.

        Args:
            parsed_item: Dict from parse() representing one clinical trial.

        Returns:
            NormalizedPaper instance.
        """
        nct_id = parsed_item.get("nct_id", "")
        title = parsed_item.get("title", "")
        brief_summary = parsed_item.get("brief_summary", "")

        # Use study_first_post_date as publication_date
        pub_date = None
        pub_date_str = parsed_item.get("study_first_post_date")
        if pub_date_str:
            try:
                pub_date = date.fromisoformat(pub_date_str)
            except (ValueError, TypeError):
                logger.warning(
                    "Could not parse study date", nct_id=nct_id, date_str=pub_date_str
                )

        content_hash = self.compute_content_hash(title, brief_summary)
        original_url = f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else None

        conditions = parsed_item.get("conditions", [])

        return NormalizedPaper(
            nct_id=nct_id,
            title=title,
            abstract=brief_summary or None,
            publication_date=pub_date,
            journal_or_origin="ClinicalTrials.gov",
            document_type="clinical_trial",
            language="en",
            original_url=original_url,
            raw_data={
                "source": "clinical_trials",
                "source_id": nct_id,
                "conditions": conditions,
                "keywords": parsed_item.get("keywords", []),
                "interventions": parsed_item.get("interventions", []),
                "phase": parsed_item.get("phase"),
                "status": parsed_item.get("status", ""),
                "enrollment": parsed_item.get("enrollment"),
                "sponsor": parsed_item.get("sponsor", ""),
                "start_date": parsed_item.get("start_date"),
                "content_hash": content_hash,
            },
        )

    @staticmethod
    def compute_content_hash(title: str, abstract: str) -> str:
        """Compute a SHA-256 hash of the trial content for deduplication."""
        content = f"{title.strip().lower()}|{abstract.strip().lower()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
