"""Unit tests for the scoring service."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.llm.base import BaseLLMProvider
from app.services.scoring import (
    ScoringError,
    ScoringResult,
    ScoringService,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_llm_response() -> dict:
    """Return a valid scoring response dict."""
    return {
        "scientific_strength_score": 7,
        "strategic_relevance_score": 8,
        "scientific_rationale": "Well-designed RCT with adequate sample size published in a top journal.",
        "strategic_rationale": "Directly applicable to the organization's manufacturing process.",
        "recommended_action": "investigate",
        "hype_risk": "low",
    }


def _make_provider(return_value: dict | None = None, side_effect: Exception | None = None) -> AsyncMock:
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


class TestScoringResult:
    """Tests for ScoringResult dataclass."""

    def test_create(self) -> None:
        result = ScoringResult(
            scientific_strength_score=7,
            strategic_relevance_score=8,
            scientific_rationale="Strong methodology.",
            strategic_rationale="Highly relevant to aligners.",
            recommended_action="investigate",
            hype_risk="low",
        )
        assert result.scientific_strength_score == 7
        assert result.strategic_relevance_score == 8
        assert result.scientific_rationale == "Strong methodology."
        assert result.strategic_rationale == "Highly relevant to aligners."
        assert result.recommended_action == "investigate"
        assert result.hype_risk == "low"

    def test_frozen(self) -> None:
        result = ScoringResult(
            scientific_strength_score=7,
            strategic_relevance_score=8,
            scientific_rationale="Strong methodology.",
            strategic_rationale="Highly relevant.",
            recommended_action="investigate",
            hype_risk="low",
        )
        with pytest.raises(AttributeError):
            result.scientific_strength_score = 5  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ScoringService — happy path
# ---------------------------------------------------------------------------


class TestScoringServiceHappyPath:
    """Tests for successful scoring."""

    async def test_score_returns_scoring_result(self) -> None:
        provider = _make_provider()
        service = ScoringService(provider)

        result = await service.score(
            title="Orthodontic Innovations",
            abstract="A study on clear aligners.",
        )

        assert isinstance(result, ScoringResult)

    async def test_score_maps_fields_correctly(self) -> None:
        provider = _make_provider()
        service = ScoringService(provider)

        result = await service.score(title="Test", abstract="Abstract")

        assert result.scientific_strength_score == 7
        assert result.strategic_relevance_score == 8
        assert (
            result.scientific_rationale
            == "Well-designed RCT with adequate sample size published in a top journal."
        )
        assert (
            result.strategic_rationale == "Directly applicable to the organization's manufacturing process."
        )
        assert result.recommended_action == "investigate"
        assert result.hype_risk == "low"

    async def test_score_calls_provider_with_prompt(self) -> None:
        provider = _make_provider()
        service = ScoringService(provider)

        await service.score(title="Test Title", abstract="Test Abstract")

        provider.complete_json.assert_awaited_once()
        call_args = provider.complete_json.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test Title" in prompt
        assert "Test Abstract" in prompt

    async def test_score_with_empty_abstract(self) -> None:
        provider = _make_provider()
        service = ScoringService(provider)

        result = await service.score(title="Test", abstract="")

        assert isinstance(result, ScoringResult)

    async def test_score_with_none_abstract(self) -> None:
        provider = _make_provider()
        service = ScoringService(provider)

        result = await service.score(title="Test", abstract=None)

        assert isinstance(result, ScoringResult)

    async def test_score_casts_float_scores_to_int(self) -> None:
        response = _valid_llm_response()
        response["scientific_strength_score"] = 7.0
        response["strategic_relevance_score"] = 8.0
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        result = await service.score(title="Test", abstract="Abstract")

        assert result.scientific_strength_score == 7
        assert isinstance(result.scientific_strength_score, int)
        assert result.strategic_relevance_score == 8
        assert isinstance(result.strategic_relevance_score, int)

    async def test_score_accepts_boundary_scores(self) -> None:
        response = _valid_llm_response()
        response["scientific_strength_score"] = 0
        response["strategic_relevance_score"] = 10
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        result = await service.score(title="Test", abstract="Abstract")

        assert result.scientific_strength_score == 0
        assert result.strategic_relevance_score == 10

    async def test_score_all_valid_actions(self) -> None:
        for action in ("monitor", "investigate", "test", "discard"):
            response = _valid_llm_response()
            response["recommended_action"] = action
            provider = _make_provider(return_value=response)
            service = ScoringService(provider)

            result = await service.score(title="Test", abstract="Abstract")

            assert result.recommended_action == action

    async def test_score_all_valid_hype_risks(self) -> None:
        for risk in ("low", "medium", "high"):
            response = _valid_llm_response()
            response["hype_risk"] = risk
            provider = _make_provider(return_value=response)
            service = ScoringService(provider)

            result = await service.score(title="Test", abstract="Abstract")

            assert result.hype_risk == risk


# ---------------------------------------------------------------------------
# ScoringService — validation errors
# ---------------------------------------------------------------------------


class TestScoringServiceValidation:
    """Tests for response validation in ScoringService."""

    async def test_rejects_scientific_score_above_ten(self) -> None:
        response = _valid_llm_response()
        response["scientific_strength_score"] = 11
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="scientific_strength_score"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_scientific_score_below_zero(self) -> None:
        response = _valid_llm_response()
        response["scientific_strength_score"] = -1
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="scientific_strength_score"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_strategic_score_above_ten(self) -> None:
        response = _valid_llm_response()
        response["strategic_relevance_score"] = 15
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="strategic_relevance_score"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_strategic_score_below_zero(self) -> None:
        response = _valid_llm_response()
        response["strategic_relevance_score"] = -2
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="strategic_relevance_score"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_invalid_recommended_action(self) -> None:
        response = _valid_llm_response()
        response["recommended_action"] = "act_now"
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="recommended_action"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_invalid_hype_risk(self) -> None:
        response = _valid_llm_response()
        response["hype_risk"] = "extreme"
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="hype_risk"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_empty_scientific_rationale(self) -> None:
        response = _valid_llm_response()
        response["scientific_rationale"] = ""
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="scientific_rationale"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_empty_strategic_rationale(self) -> None:
        response = _valid_llm_response()
        response["strategic_rationale"] = "   "
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="strategic_rationale"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_missing_required_fields(self) -> None:
        response = {"scientific_strength_score": 7}
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="[Mm]issing"):
            await service.score(title="Test", abstract="Abstract")

    async def test_rejects_non_numeric_score(self) -> None:
        response = _valid_llm_response()
        response["scientific_strength_score"] = "seven"
        provider = _make_provider(return_value=response)
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="scientific_strength_score"):
            await service.score(title="Test", abstract="Abstract")


# ---------------------------------------------------------------------------
# ScoringService — LLM errors
# ---------------------------------------------------------------------------


class TestScoringServiceLLMErrors:
    """Tests for LLM error handling in ScoringService."""

    async def test_handles_timeout_error(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="[Tt]imeout|timed out"):
            await service.score(title="Test", abstract="Abstract")

    async def test_handles_connection_error(self) -> None:
        provider = _make_provider(side_effect=ConnectionError("Connection refused"))
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="[Cc]onnection|LLM"):
            await service.score(title="Test", abstract="Abstract")

    async def test_handles_value_error_from_malformed_json(self) -> None:
        provider = _make_provider(side_effect=ValueError("Invalid JSON"))
        service = ScoringService(provider)

        with pytest.raises(ScoringError, match="JSON|json|LLM"):
            await service.score(title="Test", abstract="Abstract")

    async def test_handles_generic_exception(self) -> None:
        provider = _make_provider(side_effect=RuntimeError("Unexpected error"))
        service = ScoringService(provider)

        with pytest.raises(ScoringError):
            await service.score(title="Test", abstract="Abstract")

    async def test_error_includes_context(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ScoringService(provider)

        with pytest.raises(ScoringError) as exc_info:
            await service.score(title="Test", abstract="Abstract")

        assert exc_info.value.title == "Test"
