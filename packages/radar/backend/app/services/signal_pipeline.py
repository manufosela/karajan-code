"""Full signal processing pipeline for research items.

Orchestrates sequential execution of all LLM services (classification,
strategic classification, scoring, impact analysis, executive summary)
to process a research item end-to-end, updating DB fields after each step
and handling partial failures gracefully.
"""

from __future__ import annotations

import enum
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.models.research_item import ResearchItem
from app.services.classification import ClassificationResult, ClassificationService
from app.services.impact import ImpactAnalysisResult, ImpactAnalysisService
from app.services.scoring import ScoringResult, ScoringService
from app.services.strategic import StrategicClassificationResult, StrategicClassificationService
from app.services.summary import SummaryResult, SummaryService

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class PipelineError(Exception):
    """Raised for pipeline-level errors."""

    def __init__(self, message: str, *, step: str = "") -> None:
        super().__init__(message)
        self.step = step


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

class StepStatus(str, enum.Enum):
    """Status of a single pipeline step."""

    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class StepResult:
    """Result of a single pipeline step."""

    name: str
    status: StepStatus
    duration_ms: float
    error: str | None = None


@dataclass
class PipelineResult:
    """Result of the full pipeline execution."""

    status: str  # "completed" | "partially_processed" | "failed"
    steps: list[StepResult] = field(default_factory=list)
    duration_ms: float = 0.0


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class SignalPipelineService:
    """Orchestrates the complete signal processing pipeline.

    Runs the five LLM processing steps sequentially on a research item:
    1. Thematic classification
    2. Strategic bucket classification
    3. Scientific/strategic scoring
    4. Impact analysis & hype detection
    5. Executive summary generation

    Each step updates the research item fields and flushes to DB.
    If a step fails, the pipeline continues with the remaining steps
    and the overall status reflects partial processing.

    Args:
        provider: A BaseLLMProvider instance for LLM calls.
    """

    def __init__(self, provider: BaseLLMProvider, summary_provider: BaseLLMProvider | None = None) -> None:
        self._provider = provider
        self._classification = ClassificationService(provider)
        self._strategic = StrategicClassificationService(provider)
        self._scoring = ScoringService(provider)
        self._impact = ImpactAnalysisService(provider)
        self._summary = SummaryService(summary_provider or provider)

    async def process(
        self,
        item: ResearchItem,
        session: AsyncSession,
    ) -> PipelineResult:
        """Process a research item through the full signal pipeline.

        Args:
            item: The ResearchItem to process.
            session: An AsyncSession for DB operations. The caller is
                responsible for committing the transaction.

        Returns:
            PipelineResult with step-level status tracking.
        """
        pipeline_start = time.monotonic()
        steps: list[StepResult] = []

        # Accumulate data for downstream steps
        themes: list[str] = []
        scores: dict[str, object] = {}

        # Step 1: Thematic classification
        step = await self._run_classification(item, session)
        steps.append(step)
        if step.status == StepStatus.SUCCESS:
            themes = [t for t in (item.thematic_tags or [])]

        # Step 2: Strategic bucket classification
        step = await self._run_strategic(item, session)
        steps.append(step)

        # Step 3: Scoring
        step = await self._run_scoring(item, session)
        steps.append(step)
        if step.status == StepStatus.SUCCESS:
            scores = {
                "scientific_strength_score": int(item.scientific_strength_score or 0),
                "strategic_relevance_score": int(item.strategic_relevance_score or 0),
            }

        # Step 4: Impact analysis
        step = await self._run_impact(item, session)
        steps.append(step)

        # Step 5: Executive summary
        step = await self._run_summary(item, session, themes=themes, scores=scores)
        steps.append(step)

        # Set processing timestamp
        item.processing_timestamp = datetime.now(timezone.utc)
        await session.flush()

        # Determine overall status
        succeeded = sum(1 for s in steps if s.status == StepStatus.SUCCESS)
        if succeeded == len(steps):
            status = "completed"
        elif succeeded > 0:
            status = "partially_processed"
        else:
            status = "failed"

        duration_ms = (time.monotonic() - pipeline_start) * 1000

        logger.info(
            "pipeline_complete",
            title=item.original_title,
            status=status,
            succeeded=succeeded,
            total=len(steps),
            duration_ms=round(duration_ms, 2),
        )

        return PipelineResult(status=status, steps=steps, duration_ms=duration_ms)

    # -----------------------------------------------------------------------
    # Step runners
    # -----------------------------------------------------------------------

    async def _run_classification(
        self,
        item: ResearchItem,
        session: AsyncSession,
    ) -> StepResult:
        step_start = time.monotonic()
        try:
            result: ClassificationResult = await self._classification.classify(
                title=item.original_title,
                abstract=item.abstract,
            )
            item.thematic_tags = [t.name for t in result.themes]
            await session.flush()
            return StepResult(
                name="classification",
                status=StepStatus.SUCCESS,
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
        except Exception as exc:
            logger.warning("pipeline_step_failed", step="classification", error=str(exc))
            return StepResult(
                name="classification",
                status=StepStatus.FAILED,
                error=str(exc),
                duration_ms=(time.monotonic() - step_start) * 1000,
            )

    async def _run_strategic(
        self,
        item: ResearchItem,
        session: AsyncSession,
    ) -> StepResult:
        step_start = time.monotonic()
        try:
            result: StrategicClassificationResult = await self._strategic.classify(
                title=item.original_title,
                abstract=item.abstract,
            )
            item.strategic_buckets = [result.bucket]
            item.time_horizon = result.time_horizon
            await session.flush()
            return StepResult(
                name="strategic_classification",
                status=StepStatus.SUCCESS,
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
        except Exception as exc:
            logger.warning("pipeline_step_failed", step="strategic_classification", error=str(exc))
            return StepResult(
                name="strategic_classification",
                status=StepStatus.FAILED,
                error=str(exc),
                duration_ms=(time.monotonic() - step_start) * 1000,
            )

    async def _run_scoring(
        self,
        item: ResearchItem,
        session: AsyncSession,
    ) -> StepResult:
        step_start = time.monotonic()
        try:
            result: ScoringResult = await self._scoring.score(
                title=item.original_title,
                abstract=item.abstract,
            )
            item.scientific_strength_score = Decimal(result.scientific_strength_score)
            item.strategic_relevance_score = Decimal(result.strategic_relevance_score)
            item.scientific_strength_reasons = {"rationale": result.scientific_rationale}
            item.strategic_relevance_reasons = {"rationale": result.strategic_rationale}
            await session.flush()
            return StepResult(
                name="scoring",
                status=StepStatus.SUCCESS,
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
        except Exception as exc:
            logger.warning("pipeline_step_failed", step="scoring", error=str(exc))
            return StepResult(
                name="scoring",
                status=StepStatus.FAILED,
                error=str(exc),
                duration_ms=(time.monotonic() - step_start) * 1000,
            )

    async def _run_impact(
        self,
        item: ResearchItem,
        session: AsyncSession,
    ) -> StepResult:
        step_start = time.monotonic()
        try:
            result: ImpactAnalysisResult = await self._impact.analyze(
                title=item.original_title,
                abstract=item.abstract,
            )
            item.hype_risk = result.hype_risk
            item.confidence_level = Decimal(str(result.confidence_level))
            item.recommended_action = result.recommended_action
            await session.flush()
            return StepResult(
                name="impact_analysis",
                status=StepStatus.SUCCESS,
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
        except Exception as exc:
            logger.warning("pipeline_step_failed", step="impact_analysis", error=str(exc))
            return StepResult(
                name="impact_analysis",
                status=StepStatus.FAILED,
                error=str(exc),
                duration_ms=(time.monotonic() - step_start) * 1000,
            )

    async def _run_summary(
        self,
        item: ResearchItem,
        session: AsyncSession,
        *,
        themes: list[str],
        scores: dict[str, object],
    ) -> StepResult:
        step_start = time.monotonic()
        try:
            result: SummaryResult = await self._summary.summarize(
                title=item.original_title,
                abstract=item.abstract,
                themes=themes,
                scores=scores,
            )
            item.executive_summary_en = result.summary_en
            item.executive_summary_es = result.summary_es
            item.why_it_matters_en = result.key_findings[0] if result.key_findings else None
            item.why_it_matters_es = result.key_findings[0] if result.key_findings else None
            item.possible_impact_for_geniova_en = (
                result.implications[0] if result.implications else None
            )
            item.possible_impact_for_geniova_es = (
                result.implications[0] if result.implications else None
            )
            await session.flush()
            return StepResult(
                name="executive_summary",
                status=StepStatus.SUCCESS,
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
        except Exception as exc:
            logger.warning("pipeline_step_failed", step="executive_summary", error=str(exc))
            return StepResult(
                name="executive_summary",
                status=StepStatus.FAILED,
                error=str(exc),
                duration_ms=(time.monotonic() - step_start) * 1000,
            )
