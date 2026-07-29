"""Impact analysis and hype detection service.

Uses an LLM provider to evaluate research papers for potential business
impact on Geniova's aligner business and detect hype risk (overblown
claims vs solid evidence).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.llm.prompts.impact import (
    VALID_HYPE_RISKS,
    VALID_IMPACT_LEVELS,
    VALID_RECOMMENDED_ACTIONS,
    format_impact_prompt,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ImpactAnalysisError(Exception):
    """Raised when impact analysis fails (LLM error or invalid response)."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ImpactAnalysisResult:
    """Result of impact analysis and hype detection."""

    impact_level: str
    hype_risk: str
    confidence_level: float
    impact_areas: list[str]
    evidence_gaps: list[str]
    recommended_action: str


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class ImpactAnalysisService:
    """Analyzes research impact and detects hype risk.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
    """

    def __init__(self, provider: BaseLLMProvider) -> None:
        self._provider = provider

    async def analyze(
        self,
        title: str,
        abstract: str | None,
    ) -> ImpactAnalysisResult:
        """Analyze the impact and hype risk of a research item.

        Args:
            title: Research paper title.
            abstract: Research paper abstract (may be None or empty).

        Returns:
            ImpactAnalysisResult with impact level, hype risk,
            confidence, impact areas, evidence gaps, and
            recommended action.

        Raises:
            ImpactAnalysisError: If the LLM call fails or returns
                invalid data.
        """
        prompt = format_impact_prompt(title=title, abstract=abstract)

        try:
            response = await self._provider.complete_json(prompt)
        except TimeoutError as exc:
            logger.error("llm_timeout", title=title, error=str(exc))
            raise ImpactAnalysisError(
                f"LLM timed out while analyzing impact: {exc}",
                title=title,
            ) from exc
        except ConnectionError as exc:
            logger.error("llm_connection_error", title=title, error=str(exc))
            raise ImpactAnalysisError(
                f"LLM connection error: {exc}",
                title=title,
            ) from exc
        except ValueError as exc:
            logger.error("llm_json_error", title=title, error=str(exc))
            raise ImpactAnalysisError(
                f"LLM returned invalid JSON: {exc}",
                title=title,
            ) from exc
        except Exception as exc:
            logger.error("llm_unexpected_error", title=title, error=str(exc))
            raise ImpactAnalysisError(
                f"LLM impact analysis failed: {exc}",
                title=title,
            ) from exc

        return self._validate_response(response, title=title)

    def _validate_response(
        self,
        data: dict[str, Any],
        *,
        title: str,
    ) -> ImpactAnalysisResult:
        """Validate and convert the LLM response into an ImpactAnalysisResult.

        Raises:
            ImpactAnalysisError: If the response structure is invalid.
        """
        required = (
            "impact_level",
            "hype_risk",
            "confidence_level",
            "impact_areas",
            "evidence_gaps",
            "recommended_action",
        )
        missing = [f for f in required if f not in data]
        if missing:
            raise ImpactAnalysisError(
                f"Missing required fields in LLM response: {', '.join(missing)}",
                title=title,
            )

        impact_level = data["impact_level"]
        hype_risk = data["hype_risk"]
        confidence = data["confidence_level"]
        impact_areas = data["impact_areas"]
        evidence_gaps = data["evidence_gaps"]
        action = data["recommended_action"]

        # Validate impact_level
        if impact_level not in VALID_IMPACT_LEVELS:
            raise ImpactAnalysisError(
                f"Invalid impact_level '{impact_level}'. Must be one of: {sorted(VALID_IMPACT_LEVELS)}",
                title=title,
            )

        # Validate hype_risk
        if hype_risk not in VALID_HYPE_RISKS:
            raise ImpactAnalysisError(
                f"Invalid hype_risk '{hype_risk}'. Must be one of: {sorted(VALID_HYPE_RISKS)}",
                title=title,
            )

        # Validate confidence_level
        if not isinstance(confidence, (int, float)) or not (0 <= confidence <= 1):
            raise ImpactAnalysisError(
                f"confidence_level is {confidence}; must be a float between 0.0 and 1.0",
                title=title,
            )

        # Validate impact_areas
        if not isinstance(impact_areas, list):
            raise ImpactAnalysisError(
                f"impact_areas must be a list, got {type(impact_areas).__name__}",
                title=title,
            )

        # Validate evidence_gaps
        if not isinstance(evidence_gaps, list):
            raise ImpactAnalysisError(
                f"evidence_gaps must be a list, got {type(evidence_gaps).__name__}",
                title=title,
            )

        # Validate recommended_action
        if action not in VALID_RECOMMENDED_ACTIONS:
            raise ImpactAnalysisError(
                f"Invalid recommended_action '{action}'. Must be one of: {sorted(VALID_RECOMMENDED_ACTIONS)}",
                title=title,
            )

        logger.info(
            "impact_analysis_complete",
            title=title,
            impact_level=impact_level,
            hype_risk=hype_risk,
            confidence_level=confidence,
            recommended_action=action,
        )

        return ImpactAnalysisResult(
            impact_level=impact_level,
            hype_risk=hype_risk,
            confidence_level=float(confidence),
            impact_areas=impact_areas,
            evidence_gaps=evidence_gaps,
            recommended_action=action,
        )
