"""Scoring service for scientific strength and strategic relevance.

Uses an LLM provider to evaluate research papers on two dimensions:
scientific strength (methodology, sample size, peer review, journal impact)
and strategic relevance (alignment with Geniova's aligner business, market
impact, competitive advantage).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.llm.prompts.scoring import (
    VALID_HYPE_RISKS,
    VALID_RECOMMENDED_ACTIONS,
    format_scoring_prompt,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ScoringError(Exception):
    """Raised when scoring fails (LLM error or invalid response)."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ScoringResult:
    """Result of scientific strength and strategic relevance scoring."""

    scientific_strength_score: int
    strategic_relevance_score: int
    scientific_rationale: str
    strategic_rationale: str
    recommended_action: str
    hype_risk: str


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class ScoringService:
    """Scores research items on scientific strength and strategic relevance.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
    """

    def __init__(self, provider: BaseLLMProvider) -> None:
        self._provider = provider

    async def score(
        self,
        title: str,
        abstract: str | None,
    ) -> ScoringResult:
        """Score a research item by its title and abstract.

        Args:
            title: Research paper title.
            abstract: Research paper abstract (may be None or empty).

        Returns:
            ScoringResult with scores, rationales, recommended action,
            and hype risk.

        Raises:
            ScoringError: If the LLM call fails or returns invalid data.
        """
        prompt = format_scoring_prompt(title=title, abstract=abstract)

        try:
            response = await self._provider.complete_json(prompt)
        except TimeoutError as exc:
            logger.error("llm_timeout", title=title, error=str(exc))
            raise ScoringError(
                f"LLM timed out while scoring: {exc}",
                title=title,
            ) from exc
        except ConnectionError as exc:
            logger.error("llm_connection_error", title=title, error=str(exc))
            raise ScoringError(
                f"LLM connection error: {exc}",
                title=title,
            ) from exc
        except ValueError as exc:
            logger.error("llm_json_error", title=title, error=str(exc))
            raise ScoringError(
                f"LLM returned invalid JSON: {exc}",
                title=title,
            ) from exc
        except Exception as exc:
            logger.error("llm_unexpected_error", title=title, error=str(exc))
            raise ScoringError(
                f"LLM scoring failed: {exc}",
                title=title,
            ) from exc

        return self._validate_response(response, title=title)

    def _validate_response(
        self,
        data: dict[str, Any],
        *,
        title: str,
    ) -> ScoringResult:
        """Validate and convert the LLM response into a ScoringResult.

        Raises:
            ScoringError: If the response structure is invalid.
        """
        required = (
            "scientific_strength_score",
            "strategic_relevance_score",
            "scientific_rationale",
            "strategic_rationale",
            "recommended_action",
            "hype_risk",
        )
        missing = [f for f in required if f not in data]
        if missing:
            raise ScoringError(
                f"Missing required fields in LLM response: {', '.join(missing)}",
                title=title,
            )

        sci_score = data["scientific_strength_score"]
        strat_score = data["strategic_relevance_score"]
        sci_rationale = data["scientific_rationale"]
        strat_rationale = data["strategic_rationale"]
        action = data["recommended_action"]
        hype = data["hype_risk"]

        # Validate scientific_strength_score
        if not isinstance(sci_score, (int, float)) or not (0 <= sci_score <= 10):
            raise ScoringError(
                f"scientific_strength_score is {sci_score}; must be between 0 and 10",
                title=title,
            )

        # Validate strategic_relevance_score
        if not isinstance(strat_score, (int, float)) or not (0 <= strat_score <= 10):
            raise ScoringError(
                f"strategic_relevance_score is {strat_score}; must be between 0 and 10",
                title=title,
            )

        # Validate scientific_rationale
        if not sci_rationale or not str(sci_rationale).strip():
            raise ScoringError(
                "scientific_rationale must be a non-empty string",
                title=title,
            )

        # Validate strategic_rationale
        if not strat_rationale or not str(strat_rationale).strip():
            raise ScoringError(
                "strategic_rationale must be a non-empty string",
                title=title,
            )

        # Validate recommended_action
        if action not in VALID_RECOMMENDED_ACTIONS:
            raise ScoringError(
                f"Invalid recommended_action '{action}'. Must be one of: {sorted(VALID_RECOMMENDED_ACTIONS)}",
                title=title,
            )

        # Validate hype_risk
        if hype not in VALID_HYPE_RISKS:
            raise ScoringError(
                f"Invalid hype_risk '{hype}'. Must be one of: {sorted(VALID_HYPE_RISKS)}",
                title=title,
            )

        logger.info(
            "scoring_complete",
            title=title,
            scientific_strength_score=sci_score,
            strategic_relevance_score=strat_score,
            recommended_action=action,
            hype_risk=hype,
        )

        return ScoringResult(
            scientific_strength_score=int(sci_score),
            strategic_relevance_score=int(strat_score),
            scientific_rationale=sci_rationale,
            strategic_rationale=strat_rationale,
            recommended_action=action,
            hype_risk=hype,
        )
