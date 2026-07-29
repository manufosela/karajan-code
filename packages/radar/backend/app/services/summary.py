"""Executive summary generation service (bilingual EN + ES).

Uses an LLM provider to generate concise executive summaries of research
items in both English and Spanish, along with key findings and strategic
implications for the organization the radar reports for.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.profiles.active import get_prompt_renderer
from app.profiles.renderer import PromptRenderer

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class SummaryError(Exception):
    """Raised when summary generation fails (LLM error or invalid response)."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SummaryResult:
    """Result of executive summary generation."""

    summary_en: str
    summary_es: str
    key_findings: list[str]
    implications: list[str]


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class SummaryService:
    """Generates bilingual executive summaries for research items.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
    """

    def __init__(
        self,
        provider: BaseLLMProvider,
        renderer: PromptRenderer | None = None,
    ) -> None:
        self._provider = provider
        self._renderer = renderer if renderer is not None else get_prompt_renderer()

    @property
    def required_fields(self) -> frozenset[str]:
        """Response fields the active profile expects.

        One summary field per configured language, plus the fields every
        summary carries regardless of domain.
        """
        languages = self._renderer.profile.summary.languages
        return frozenset({f"summary_{code}" for code in languages}) | {
            "key_findings",
            "implications",
        }

    async def summarize(
        self,
        title: str,
        abstract: str | None,
        themes: list[str],
        scores: dict[str, object],
    ) -> SummaryResult:
        """Generate an executive summary for a research item.

        Args:
            title: Research paper title.
            abstract: Research paper abstract (may be None or empty).
            themes: List of assigned theme names.
            scores: Dictionary of evaluation scores.

        Returns:
            SummaryResult with bilingual summaries, key findings,
            and implications.

        Raises:
            SummaryError: If the LLM call fails or returns invalid data.
        """
        prompt = self._renderer.render(
            "summary",
            title=title,
            abstract=abstract if abstract else "No abstract available.",
            assigned_themes=", ".join(themes) if themes else "none assigned",
            scientific_strength_score=scores.get("scientific_strength_score", "n/a"),
            strategic_relevance_score=scores.get("strategic_relevance_score", "n/a"),
        )

        try:
            response = await self._provider.complete_json(prompt)
        except TimeoutError as exc:
            logger.error("llm_timeout", title=title, error=str(exc))
            raise SummaryError(
                f"LLM timed out while generating summary: {exc}",
                title=title,
            ) from exc
        except ConnectionError as exc:
            logger.error("llm_connection_error", title=title, error=str(exc))
            raise SummaryError(
                f"LLM connection error: {exc}",
                title=title,
            ) from exc
        except ValueError as exc:
            logger.error("llm_json_error", title=title, error=str(exc))
            raise SummaryError(
                f"LLM returned invalid JSON: {exc}",
                title=title,
            ) from exc
        except Exception as exc:
            logger.error("llm_unexpected_error", title=title, error=str(exc))
            raise SummaryError(
                f"LLM summary generation failed: {exc}",
                title=title,
            ) from exc

        return self._validate_response(response, title=title)

    def _validate_response(
        self,
        data: dict[str, Any],
        *,
        title: str,
    ) -> SummaryResult:
        """Validate and convert the LLM response into a SummaryResult.

        Raises:
            SummaryError: If the response structure is invalid.
        """
        missing = [f for f in sorted(self.required_fields) if f not in data]
        if missing:
            raise SummaryError(
                f"Missing required fields in LLM response: {', '.join(sorted(missing))}",
                title=title,
            )

        summary_en = data["summary_en"]
        summary_es = data["summary_es"]
        key_findings = data["key_findings"]
        implications = data["implications"]

        # Validate summary_en
        if not summary_en or not str(summary_en).strip():
            raise SummaryError(
                "summary_en must be a non-empty string",
                title=title,
            )

        # Validate summary_es
        if not summary_es or not str(summary_es).strip():
            raise SummaryError(
                "summary_es must be a non-empty string",
                title=title,
            )

        # Validate key_findings
        if not isinstance(key_findings, list):
            raise SummaryError(
                "key_findings must be a list of strings",
                title=title,
            )
        if not key_findings:
            raise SummaryError(
                "key_findings must be a non-empty list",
                title=title,
            )
        for finding in key_findings:
            if not finding or not str(finding).strip():
                raise SummaryError(
                    "All key_findings must be non-empty strings",
                    title=title,
                )

        # Validate implications
        if not isinstance(implications, list):
            raise SummaryError(
                "implications must be a list of strings",
                title=title,
            )
        if not implications:
            raise SummaryError(
                "implications must be a non-empty list",
                title=title,
            )
        for implication in implications:
            if not implication or not str(implication).strip():
                raise SummaryError(
                    "All implications must be non-empty strings",
                    title=title,
                )

        logger.info(
            "summary_complete",
            title=title,
            key_findings_count=len(key_findings),
            implications_count=len(implications),
        )

        return SummaryResult(
            summary_en=summary_en,
            summary_es=summary_es,
            key_findings=key_findings,
            implications=implications,
        )
