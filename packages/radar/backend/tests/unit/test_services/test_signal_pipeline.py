"""Unit tests for the signal processing pipeline service."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.llm.base import BaseLLMProvider
from app.services.classification import ClassificationError, ClassificationResult, ThemeScore
from app.services.impact import ImpactAnalysisError, ImpactAnalysisResult
from app.services.scoring import ScoringError, ScoringResult
from app.services.strategic import StrategicClassificationError, StrategicClassificationResult
from app.services.summary import SummaryError, SummaryResult
from app.services.signal_pipeline import (
    PipelineError,
    PipelineResult,
    SignalPipelineService,
    StepResult,
    StepStatus,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_research_item() -> MagicMock:
    """Create a mock ResearchItem with required fields."""
    item = MagicMock()
    item.original_title = "Novel Aligner Material Study"
    item.abstract = "A study on new polymer materials for clear aligners."
    item.thematic_tags = []
    item.strategic_buckets = []
    item.scientific_strength_score = None
    item.scientific_strength_reasons = None
    item.strategic_relevance_score = None
    item.strategic_relevance_reasons = None
    item.hype_risk = None
    item.time_horizon = None
    item.recommended_action = None
    item.confidence_level = None
    item.executive_summary_en = None
    item.executive_summary_es = None
    item.why_it_matters_en = None
    item.why_it_matters_es = None
    item.possible_impact_for_geniova_en = None
    item.possible_impact_for_geniova_es = None
    item.processing_timestamp = None
    return item


def _make_session() -> AsyncMock:
    """Create a mock AsyncSession."""
    session = AsyncMock()
    session.flush = AsyncMock()
    return session


def _classification_result() -> ClassificationResult:
    return ClassificationResult(
        themes=[
            ThemeScore(name="materials", confidence=0.9),
            ThemeScore(name="biomechanics", confidence=0.6),
        ],
        primary_theme="materials",
        keywords=["polymer", "aligner"],
    )


def _strategic_result() -> StrategicClassificationResult:
    return StrategicClassificationResult(
        bucket="emerging_materials",
        confidence=0.85,
        rationale="New polymer for aligners",
        time_horizon="medium_term",
    )


def _scoring_result() -> ScoringResult:
    return ScoringResult(
        scientific_strength_score=7,
        strategic_relevance_score=8,
        scientific_rationale="Well-designed study with adequate sample size.",
        strategic_rationale="Directly relevant to aligner manufacturing.",
        recommended_action="investigate",
        hype_risk="low",
    )


def _impact_result() -> ImpactAnalysisResult:
    return ImpactAnalysisResult(
        impact_level="significant",
        hype_risk="medium",
        confidence_level=0.75,
        impact_areas=["aligner_manufacturing"],
        evidence_gaps=["Small sample size"],
        recommended_action="investigate",
    )


def _summary_result() -> SummaryResult:
    return SummaryResult(
        summary_en="This study presents a novel polymer material.",
        summary_es="Este estudio presenta un material polimerico novedoso.",
        key_findings=["New polymer is 30% stronger"],
        implications=["Could improve aligner durability"],
    )


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

class TestStepResult:
    """Tests for StepResult dataclass."""

    def test_create_success(self) -> None:
        step = StepResult(name="classification", status=StepStatus.SUCCESS, duration_ms=150.0)
        assert step.name == "classification"
        assert step.status == StepStatus.SUCCESS
        assert step.error is None
        assert step.duration_ms == 150.0

    def test_create_failed(self) -> None:
        step = StepResult(
            name="scoring",
            status=StepStatus.FAILED,
            error="LLM timed out",
            duration_ms=5000.0,
        )
        assert step.status == StepStatus.FAILED
        assert step.error == "LLM timed out"


class TestPipelineResult:
    """Tests for PipelineResult dataclass."""

    def test_create_completed(self) -> None:
        result = PipelineResult(
            status="completed",
            steps=[StepResult(name="classification", status=StepStatus.SUCCESS, duration_ms=100.0)],
            duration_ms=500.0,
        )
        assert result.status == "completed"
        assert len(result.steps) == 1
        assert result.duration_ms == 500.0

    def test_create_partially_processed(self) -> None:
        result = PipelineResult(
            status="partially_processed",
            steps=[
                StepResult(name="classification", status=StepStatus.SUCCESS, duration_ms=100.0),
                StepResult(name="scoring", status=StepStatus.FAILED, error="Error", duration_ms=50.0),
            ],
            duration_ms=150.0,
        )
        assert result.status == "partially_processed"


class TestPipelineError:
    """Tests for PipelineError exception."""

    def test_create_with_message(self) -> None:
        err = PipelineError("Something went wrong", step="classification")
        assert str(err) == "Something went wrong"
        assert err.step == "classification"

    def test_create_without_step(self) -> None:
        err = PipelineError("General error")
        assert err.step == ""


# ---------------------------------------------------------------------------
# SignalPipelineService — happy path
# ---------------------------------------------------------------------------

class TestSignalPipelineHappyPath:
    """Tests for successful full pipeline processing."""

    async def test_all_steps_succeed_returns_completed(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()) as mock_cls,
            patch.object(service._strategic, "classify", return_value=_strategic_result()) as mock_str,
            patch.object(service._scoring, "score", return_value=_scoring_result()) as mock_sco,
            patch.object(service._impact, "analyze", return_value=_impact_result()) as mock_imp,
            patch.object(service._summary, "summarize", return_value=_summary_result()) as mock_sum,
        ):
            result = await service.process(item, session)

        assert result.status == "completed"
        assert len(result.steps) == 5
        assert all(s.status == StepStatus.SUCCESS for s in result.steps)
        assert result.duration_ms > 0

    async def test_classification_updates_item_fields(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.thematic_tags == ["materials", "biomechanics"]

    async def test_strategic_updates_item_fields(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.strategic_buckets == ["emerging_materials"]
        assert item.time_horizon == "medium_term"

    async def test_scoring_updates_item_fields(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.scientific_strength_score == Decimal(7)
        assert item.strategic_relevance_score == Decimal(8)
        assert item.scientific_strength_reasons == {
            "rationale": "Well-designed study with adequate sample size.",
        }
        assert item.strategic_relevance_reasons == {
            "rationale": "Directly relevant to aligner manufacturing.",
        }

    async def test_impact_updates_item_fields(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.hype_risk == "medium"
        assert item.confidence_level == Decimal("0.75")
        assert item.recommended_action == "investigate"

    async def test_summary_updates_item_fields(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.executive_summary_en == "This study presents a novel polymer material."
        assert item.executive_summary_es == "Este estudio presenta un material polimerico novedoso."
        assert item.why_it_matters_en == "New polymer is 30% stronger"
        assert item.why_it_matters_es == "New polymer is 30% stronger"
        assert item.possible_impact_for_geniova_en == "Could improve aligner durability"
        assert item.possible_impact_for_geniova_es == "Could improve aligner durability"

    async def test_processing_timestamp_set(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        assert item.processing_timestamp is not None
        assert isinstance(item.processing_timestamp, datetime)

    async def test_session_flushed_after_each_step(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        # 5 steps + 1 final flush for processing_timestamp
        assert session.flush.await_count == 6

    async def test_steps_executed_in_order(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        step_names = [s.name for s in result.steps]
        assert step_names == [
            "classification",
            "strategic_classification",
            "scoring",
            "impact_analysis",
            "executive_summary",
        ]

    async def test_summary_receives_themes_and_scores(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()) as mock_sum,
        ):
            await service.process(item, session)

        mock_sum.assert_awaited_once()
        call_kwargs = mock_sum.call_args.kwargs
        assert call_kwargs["themes"] == ["materials", "biomechanics"]
        assert call_kwargs["scores"]["scientific_strength_score"] == 7
        assert call_kwargs["scores"]["strategic_relevance_score"] == 8


# ---------------------------------------------------------------------------
# SignalPipelineService — partial failures
# ---------------------------------------------------------------------------

class TestSignalPipelinePartialFailures:
    """Tests for partial failure handling."""

    async def test_classification_fails_continues_others(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("LLM timeout", title="Test"),
            ),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        assert result.status == "partially_processed"
        assert result.steps[0].status == StepStatus.FAILED
        assert result.steps[0].error is not None
        assert all(s.status == StepStatus.SUCCESS for s in result.steps[1:])

    async def test_scoring_fails_continues_others(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("LLM error", title="Test"),
            ),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        assert result.status == "partially_processed"
        assert result.steps[2].name == "scoring"
        assert result.steps[2].status == StepStatus.FAILED

    async def test_summary_fails_still_partially_processed(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(
                service._summary, "summarize",
                side_effect=SummaryError("LLM error", title="Test"),
            ),
        ):
            result = await service.process(item, session)

        assert result.status == "partially_processed"
        assert result.steps[4].name == "executive_summary"
        assert result.steps[4].status == StepStatus.FAILED

    async def test_classification_fails_summary_gets_empty_themes(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()) as mock_sum,
        ):
            await service.process(item, session)

        call_kwargs = mock_sum.call_args.kwargs
        assert call_kwargs["themes"] == []

    async def test_scoring_fails_summary_gets_empty_scores(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("Error", title="Test"),
            ),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()) as mock_sum,
        ):
            await service.process(item, session)

        call_kwargs = mock_sum.call_args.kwargs
        assert call_kwargs["scores"] == {}

    async def test_multiple_steps_fail(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("Error", title="Test"),
            ),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        assert result.status == "partially_processed"
        failed = [s for s in result.steps if s.status == StepStatus.FAILED]
        assert len(failed) == 2

    async def test_failed_step_does_not_flush(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            await service.process(item, session)

        # 4 successful steps + 1 final flush = 5 (not 6)
        assert session.flush.await_count == 5


# ---------------------------------------------------------------------------
# SignalPipelineService — all steps fail
# ---------------------------------------------------------------------------

class TestSignalPipelineAllFail:
    """Tests for when all steps fail."""

    async def test_all_steps_fail_returns_failed(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._strategic, "classify",
                side_effect=StrategicClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("Error", title="Test"),
            ),
            patch.object(
                service._impact, "analyze",
                side_effect=ImpactAnalysisError("Error", title="Test"),
            ),
            patch.object(
                service._summary, "summarize",
                side_effect=SummaryError("Error", title="Test"),
            ),
        ):
            result = await service.process(item, session)

        assert result.status == "failed"
        assert all(s.status == StepStatus.FAILED for s in result.steps)

    async def test_all_fail_still_sets_timestamp(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._strategic, "classify",
                side_effect=StrategicClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("Error", title="Test"),
            ),
            patch.object(
                service._impact, "analyze",
                side_effect=ImpactAnalysisError("Error", title="Test"),
            ),
            patch.object(
                service._summary, "summarize",
                side_effect=SummaryError("Error", title="Test"),
            ),
        ):
            await service.process(item, session)

        assert item.processing_timestamp is not None

    async def test_all_fail_no_step_flushes(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=ClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._strategic, "classify",
                side_effect=StrategicClassificationError("Error", title="Test"),
            ),
            patch.object(
                service._scoring, "score",
                side_effect=ScoringError("Error", title="Test"),
            ),
            patch.object(
                service._impact, "analyze",
                side_effect=ImpactAnalysisError("Error", title="Test"),
            ),
            patch.object(
                service._summary, "summarize",
                side_effect=SummaryError("Error", title="Test"),
            ),
        ):
            await service.process(item, session)

        # Only the final timestamp flush
        assert session.flush.await_count == 1


# ---------------------------------------------------------------------------
# SignalPipelineService — unexpected exceptions
# ---------------------------------------------------------------------------

class TestSignalPipelineUnexpectedErrors:
    """Tests for unexpected (non-service) errors."""

    async def test_unexpected_error_in_step_is_caught(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(
                service._classification, "classify",
                side_effect=RuntimeError("Unexpected"),
            ),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        assert result.status == "partially_processed"
        assert result.steps[0].status == StepStatus.FAILED
        assert "Unexpected" in result.steps[0].error


# ---------------------------------------------------------------------------
# SignalPipelineService — step duration tracking
# ---------------------------------------------------------------------------

class TestSignalPipelineStepDuration:
    """Tests for step duration tracking."""

    async def test_each_step_has_positive_duration(self) -> None:
        provider = AsyncMock(spec=BaseLLMProvider)
        service = SignalPipelineService(provider)
        item = _make_research_item()
        session = _make_session()

        with (
            patch.object(service._classification, "classify", return_value=_classification_result()),
            patch.object(service._strategic, "classify", return_value=_strategic_result()),
            patch.object(service._scoring, "score", return_value=_scoring_result()),
            patch.object(service._impact, "analyze", return_value=_impact_result()),
            patch.object(service._summary, "summarize", return_value=_summary_result()),
        ):
            result = await service.process(item, session)

        for step in result.steps:
            assert step.duration_ms >= 0
