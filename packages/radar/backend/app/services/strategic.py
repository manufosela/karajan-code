"""Strategic classification service for research items.

Uses an LLM provider to classify research papers into strategic buckets
(core_aligner_tech, emerging_materials, ai_digital_workflow, etc.)
and assess their time horizon for industry impact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.llm.prompts.strategic import (
    VALID_BUCKETS,
    VALID_TIME_HORIZONS,
    format_strategic_prompt,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class StrategicClassificationError(Exception):
    """Raised when strategic classification fails (LLM error or invalid response)."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StrategicClassificationResult:
    """Result of strategic bucket classification."""

    bucket: str
    confidence: float
    rationale: str
    time_horizon: str


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class StrategicClassificationService:
    """Classifies research items into strategic buckets using an LLM.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
    """

    def __init__(self, provider: BaseLLMProvider) -> None:
        self._provider = provider

    async def classify(
        self,
        title: str,
        abstract: str | None,
    ) -> StrategicClassificationResult:
        """Classify a research item into a strategic bucket.

        Args:
            title: Research paper title.
            abstract: Research paper abstract (may be None or empty).

        Returns:
            StrategicClassificationResult with bucket, confidence, rationale,
            and time_horizon.

        Raises:
            StrategicClassificationError: If the LLM call fails or returns
                invalid data.
        """
        prompt = format_strategic_prompt(title=title, abstract=abstract)

        try:
            response = await self._provider.complete_json(prompt)
        except TimeoutError as exc:
            logger.error("llm_timeout", title=title, error=str(exc))
            raise StrategicClassificationError(
                f"LLM timed out while classifying: {exc}",
                title=title,
            ) from exc
        except ConnectionError as exc:
            logger.error("llm_connection_error", title=title, error=str(exc))
            raise StrategicClassificationError(
                f"LLM connection error: {exc}",
                title=title,
            ) from exc
        except ValueError as exc:
            logger.error("llm_json_error", title=title, error=str(exc))
            raise StrategicClassificationError(
                f"LLM returned invalid JSON: {exc}",
                title=title,
            ) from exc
        except Exception as exc:
            logger.error("llm_unexpected_error", title=title, error=str(exc))
            raise StrategicClassificationError(
                f"LLM strategic classification failed: {exc}",
                title=title,
            ) from exc

        return self._validate_response(response, title=title)

    def _validate_response(
        self,
        data: dict[str, Any],
        *,
        title: str,
    ) -> StrategicClassificationResult:
        """Validate and convert the LLM response into a StrategicClassificationResult.

        Raises:
            StrategicClassificationError: If the response structure is invalid.
        """
        # Check required fields
        required = ("bucket", "confidence", "rationale", "time_horizon")
        missing = [f for f in required if f not in data]
        if missing:
            raise StrategicClassificationError(
                f"Missing required fields in LLM response: {', '.join(missing)}",
                title=title,
            )

        bucket = data["bucket"]
        confidence = data["confidence"]
        rationale = data["rationale"]
        time_horizon = data["time_horizon"]

        # Validate bucket
        if bucket not in VALID_BUCKETS:
            raise StrategicClassificationError(
                f"Invalid bucket '{bucket}'. Must be one of: {sorted(VALID_BUCKETS)}",
                title=title,
            )

        # Validate confidence
        if not (0.0 <= confidence <= 1.0):
            raise StrategicClassificationError(
                f"Confidence is {confidence}; must be between 0.0 and 1.0",
                title=title,
            )

        # Validate rationale
        if not rationale or not rationale.strip():
            raise StrategicClassificationError(
                "Rationale must be a non-empty string",
                title=title,
            )

        # Validate time_horizon
        if time_horizon not in VALID_TIME_HORIZONS:
            raise StrategicClassificationError(
                f"Invalid time_horizon '{time_horizon}'. Must be one of: {sorted(VALID_TIME_HORIZONS)}",
                title=title,
            )

        logger.info(
            "strategic_classification_complete",
            title=title,
            bucket=bucket,
            confidence=confidence,
            time_horizon=time_horizon,
        )

        return StrategicClassificationResult(
            bucket=bucket,
            confidence=confidence,
            rationale=rationale,
            time_horizon=time_horizon,
        )
