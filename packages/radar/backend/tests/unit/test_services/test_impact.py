"""Unit tests for the impact analysis service."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.llm.base import BaseLLMProvider
from app.services.impact import (
    ImpactAnalysisError,
    ImpactAnalysisResult,
    ImpactAnalysisService,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid_llm_response() -> dict:
    """Return a valid impact analysis response dict."""
    return {
        "impact_level": "significant",
        "hype_risk": "medium",
        "confidence_level": 0.75,
        "impact_areas": ["aligner_manufacturing", "treatment_planning"],
        "evidence_gaps": ["No long-term clinical data", "Small sample size"],
        "recommended_action": "investigate",
    }


def _make_provider(
    return_value: dict | None = None,
    side_effect: Exception | None = None,
) -> AsyncMock:
    """Create a mocked BaseLLMProvider."""
    provider = AsyncMock(spec=BaseLLMProvider)
    if side_effect:
        provider.complete_json.side_effect = side_effect
    else:
        provider.complete_json.return_value = return_value or _valid_llm_response()
    return provider


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

class TestImpactAnalysisResult:
    """Tests for ImpactAnalysisResult dataclass."""

    def test_create(self) -> None:
        result = ImpactAnalysisResult(
            impact_level="significant",
            hype_risk="medium",
            confidence_level=0.75,
            impact_areas=["aligner_manufacturing"],
            evidence_gaps=["Small sample size"],
            recommended_action="investigate",
        )
        assert result.impact_level == "significant"
        assert result.hype_risk == "medium"
        assert result.confidence_level == 0.75
        assert result.impact_areas == ["aligner_manufacturing"]
        assert result.evidence_gaps == ["Small sample size"]
        assert result.recommended_action == "investigate"

    def test_frozen(self) -> None:
        result = ImpactAnalysisResult(
            impact_level="significant",
            hype_risk="medium",
            confidence_level=0.75,
            impact_areas=["aligner_manufacturing"],
            evidence_gaps=["Small sample size"],
            recommended_action="investigate",
        )
        with pytest.raises(AttributeError):
            result.impact_level = "moderate"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ImpactAnalysisService — happy path
# ---------------------------------------------------------------------------

class TestImpactAnalysisServiceHappyPath:
    """Tests for successful impact analysis."""

    async def test_analyze_returns_result(self) -> None:
        provider = _make_provider()
        service = ImpactAnalysisService(provider)

        result = await service.analyze(
            title="Novel Clear Aligner Material",
            abstract="A study on a new polymer for aligners.",
        )

        assert isinstance(result, ImpactAnalysisResult)

    async def test_analyze_maps_fields_correctly(self) -> None:
        provider = _make_provider()
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="Abstract")

        assert result.impact_level == "significant"
        assert result.hype_risk == "medium"
        assert result.confidence_level == 0.75
        assert result.impact_areas == ["aligner_manufacturing", "treatment_planning"]
        assert result.evidence_gaps == ["No long-term clinical data", "Small sample size"]
        assert result.recommended_action == "investigate"

    async def test_analyze_calls_provider_with_prompt(self) -> None:
        provider = _make_provider()
        service = ImpactAnalysisService(provider)

        await service.analyze(title="Test Title", abstract="Test Abstract")

        provider.complete_json.assert_awaited_once()
        call_args = provider.complete_json.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test Title" in prompt
        assert "Test Abstract" in prompt

    async def test_analyze_with_empty_abstract(self) -> None:
        provider = _make_provider()
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="")

        assert isinstance(result, ImpactAnalysisResult)

    async def test_analyze_with_none_abstract(self) -> None:
        provider = _make_provider()
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract=None)

        assert isinstance(result, ImpactAnalysisResult)

    async def test_analyze_all_valid_impact_levels(self) -> None:
        for level in ("transformative", "significant", "moderate", "incremental", "minimal"):
            response = _valid_llm_response()
            response["impact_level"] = level
            provider = _make_provider(return_value=response)
            service = ImpactAnalysisService(provider)

            result = await service.analyze(title="Test", abstract="Abstract")

            assert result.impact_level == level

    async def test_analyze_all_valid_hype_risks(self) -> None:
        for risk in ("low", "medium", "high"):
            response = _valid_llm_response()
            response["hype_risk"] = risk
            provider = _make_provider(return_value=response)
            service = ImpactAnalysisService(provider)

            result = await service.analyze(title="Test", abstract="Abstract")

            assert result.hype_risk == risk

    async def test_analyze_all_valid_recommended_actions(self) -> None:
        for action in ("monitor", "investigate", "act_now", "archive"):
            response = _valid_llm_response()
            response["recommended_action"] = action
            provider = _make_provider(return_value=response)
            service = ImpactAnalysisService(provider)

            result = await service.analyze(title="Test", abstract="Abstract")

            assert result.recommended_action == action

    async def test_analyze_boundary_confidence_zero(self) -> None:
        response = _valid_llm_response()
        response["confidence_level"] = 0.0
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="Abstract")

        assert result.confidence_level == 0.0

    async def test_analyze_boundary_confidence_one(self) -> None:
        response = _valid_llm_response()
        response["confidence_level"] = 1.0
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="Abstract")

        assert result.confidence_level == 1.0

    async def test_analyze_empty_impact_areas_allowed(self) -> None:
        response = _valid_llm_response()
        response["impact_areas"] = []
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="Abstract")

        assert result.impact_areas == []

    async def test_analyze_empty_evidence_gaps_allowed(self) -> None:
        response = _valid_llm_response()
        response["evidence_gaps"] = []
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        result = await service.analyze(title="Test", abstract="Abstract")

        assert result.evidence_gaps == []


# ---------------------------------------------------------------------------
# ImpactAnalysisService — validation errors
# ---------------------------------------------------------------------------

class TestImpactAnalysisServiceValidation:
    """Tests for response validation in ImpactAnalysisService."""

    async def test_rejects_invalid_impact_level(self) -> None:
        response = _valid_llm_response()
        response["impact_level"] = "revolutionary"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="impact_level"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_invalid_hype_risk(self) -> None:
        response = _valid_llm_response()
        response["hype_risk"] = "extreme"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="hype_risk"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_invalid_recommended_action(self) -> None:
        response = _valid_llm_response()
        response["recommended_action"] = "discard"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="recommended_action"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_confidence_above_one(self) -> None:
        response = _valid_llm_response()
        response["confidence_level"] = 1.5
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="confidence_level"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_confidence_below_zero(self) -> None:
        response = _valid_llm_response()
        response["confidence_level"] = -0.1
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="confidence_level"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_non_numeric_confidence(self) -> None:
        response = _valid_llm_response()
        response["confidence_level"] = "high"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="confidence_level"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_non_list_impact_areas(self) -> None:
        response = _valid_llm_response()
        response["impact_areas"] = "aligner_manufacturing"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="impact_areas"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_non_list_evidence_gaps(self) -> None:
        response = _valid_llm_response()
        response["evidence_gaps"] = "No data"
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="evidence_gaps"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_rejects_missing_required_fields(self) -> None:
        response = {"impact_level": "significant"}
        provider = _make_provider(return_value=response)
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="[Mm]issing"):
            await service.analyze(title="Test", abstract="Abstract")


# ---------------------------------------------------------------------------
# ImpactAnalysisService — LLM errors
# ---------------------------------------------------------------------------

class TestImpactAnalysisServiceLLMErrors:
    """Tests for LLM error handling in ImpactAnalysisService."""

    async def test_handles_timeout_error(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="[Tt]imeout|timed out"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_handles_connection_error(self) -> None:
        provider = _make_provider(side_effect=ConnectionError("Connection refused"))
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="[Cc]onnection|LLM"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_handles_value_error_from_malformed_json(self) -> None:
        provider = _make_provider(side_effect=ValueError("Invalid JSON"))
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError, match="JSON|json|LLM"):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_handles_generic_exception(self) -> None:
        provider = _make_provider(side_effect=RuntimeError("Unexpected error"))
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError):
            await service.analyze(title="Test", abstract="Abstract")

    async def test_error_includes_context(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ImpactAnalysisService(provider)

        with pytest.raises(ImpactAnalysisError) as exc_info:
            await service.analyze(title="Test", abstract="Abstract")

        assert exc_info.value.title == "Test"
