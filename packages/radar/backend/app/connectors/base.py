from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import httpx
from aiolimiter import AsyncLimiter
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.logging import get_logger

logger = get_logger(__name__)


class NormalizedPaper(BaseModel):
    """Normalized representation of a research paper from any source."""

    doi: str | None = None
    pmid: str | None = None
    nct_id: str | None = None
    arxiv_id: str | None = None
    original_url: str | None = None
    title: str
    authors: list[dict[str, Any]] = field(default_factory=list)  # type: ignore[assignment]
    publication_date: date | None = None
    abstract: str | None = None
    journal_or_origin: str | None = None
    document_type: str = "paper"
    language: str = "en"
    raw_data: dict[str, Any] = field(default_factory=dict)  # type: ignore[assignment]


@dataclass
class ConnectorResult:
    """Result of a connector run."""

    source_name: str
    papers: list[NormalizedPaper] = field(default_factory=list)
    total_fetched: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def success_count(self) -> int:
        return len(self.papers)

    @property
    def error_count(self) -> int:
        return len(self.errors)


class BaseConnector(ABC):
    """Abstract base connector for all research data sources.

    Subclasses must implement fetch(), parse(), and normalize().
    The run() method orchestrates the full pipeline: fetch -> parse -> normalize.
    Includes built-in rate limiting (aiolimiter) and retry logic (tenacity).
    """

    def __init__(
        self,
        source_name: str,
        base_url: str,
        config: dict[str, Any] | None = None,
        rate_limit: float = 1.0,
        rate_limit_period: float = 1.0,
        max_retries: int = 3,
    ) -> None:
        self.source_name = source_name
        self.base_url = base_url.rstrip("/")
        self.config = config or {}
        self.max_retries = max_retries
        self._limiter = AsyncLimiter(rate_limit, rate_limit_period)
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(30.0),
            headers={"User-Agent": "KarajanRadar/1.0"},
        )

    async def __aenter__(self) -> "BaseConnector":
        return self

    async def __aexit__(self, exc_type: type | None, exc_val: Exception | None, exc_tb: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    @abstractmethod
    async def fetch(self) -> dict[str, Any]:
        """Fetch raw data from the source API. Returns raw response data."""
        ...

    @abstractmethod
    def parse(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse raw API response into a list of individual item dicts."""
        ...

    @abstractmethod
    def normalize(self, parsed_item: dict[str, Any]) -> NormalizedPaper:
        """Normalize a single parsed item into a NormalizedPaper."""
        ...

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    async def _fetch_with_retry(self) -> dict[str, Any]:
        """Fetch with retry logic and rate limiting."""
        async with self._limiter:
            logger.info("Fetching from source", source=self.source_name)
            return await self.fetch()

    async def run(self) -> ConnectorResult:
        """Orchestrate the full connector pipeline: fetch -> parse -> normalize."""
        result = ConnectorResult(
            source_name=self.source_name,
            started_at=datetime.utcnow(),
        )

        try:
            raw_data = await self._fetch_with_retry()
            parsed_items = self.parse(raw_data)
            result.total_fetched = len(parsed_items)

            for item in parsed_items:
                try:
                    normalized = self.normalize(item)
                    result.papers.append(normalized)
                except Exception as e:
                    logger.warning(
                        "Failed to normalize item",
                        source=self.source_name,
                        error=str(e),
                    )
                    result.errors.append(
                        {
                            "message": f"Normalization error: {e}",
                            "item": str(item)[:500],
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    )

        except Exception as e:
            logger.error("Connector fetch failed", source=self.source_name, error=str(e))
            result.errors.append(
                {
                    "message": f"Fetch error: {e}",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )

        result.completed_at = datetime.utcnow()
        logger.info(
            "Connector run completed",
            source=self.source_name,
            fetched=result.total_fetched,
            normalized=result.success_count,
            errors=result.error_count,
        )
        return result
