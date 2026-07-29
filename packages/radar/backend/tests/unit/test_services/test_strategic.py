"""Unit tests for the strategic classification service."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.llm.base import BaseLLMProvider
from app.profiles.active import get_active_profile
from app.services.strategic import (
    StrategicClassificationError,
    StrategicClassificationResult,
    StrategicClassificationService,
)

# The taxonomy now comes from the active Radar Profile rather than from
# module-level constants in app.llm.prompts.strategic.
_TAXONOMY = get_active_profile().taxonomy
VALID_BUCKETS = _TAXONOMY.bucket_ids
VALID_TIME_HORIZONS = _TAXONOMY.time_horizon_ids

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_llm_response() -> dict:
    """Return a valid strategic classification response dict."""
    return {
        "bucket": "ai_digital_workflow",
        "confidence": 0.88,
        "rationale": "The paper focuses on AI-driven digital planning for orthodontic treatment.",
        "time_horizon": "short_term",
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


class TestStrategicClassificationResult:
    """Tests for StrategicClassificationResult dataclass."""

    def test_create(self) -> None:
        result = StrategicClassificationResult(
            bucket="ai_digital_workflow",
            confidence=0.88,
            rationale="AI-driven planning.",
            time_horizon="short_term",
        )
        assert result.bucket == "ai_digital_workflow"
        assert result.confidence == 0.88
        assert result.rationale == "AI-driven planning."
        assert result.time_horizon == "short_term"

    def test_frozen(self) -> None:
        result = StrategicClassificationResult(
            bucket="ai_digital_workflow",
            confidence=0.88,
            rationale="AI-driven planning.",
            time_horizon="short_term",
        )
        with pytest.raises(AttributeError):
            result.bucket = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# StrategicClassificationService — happy path
# ---------------------------------------------------------------------------


class TestStrategicClassificationServiceHappyPath:
    """Tests for successful strategic classification."""

    async def test_classify_returns_result(self) -> None:
        provider = _make_provider()
        service = StrategicClassificationService(provider)

        result = await service.classify(
            title="AI-based orthodontic planning",
            abstract="Deep learning for treatment planning.",
        )

        assert isinstance(result, StrategicClassificationResult)

    async def test_classify_maps_fields_correctly(self) -> None:
        provider = _make_provider()
        service = StrategicClassificationService(provider)

        result = await service.classify(title="Test", abstract="Abstract")

        assert result.bucket == "ai_digital_workflow"
        assert result.confidence == 0.88
        assert (
            result.rationale == "The paper focuses on AI-driven digital planning for orthodontic treatment."
        )
        assert result.time_horizon == "short_term"

    async def test_classify_calls_provider_with_prompt(self) -> None:
        provider = _make_provider()
        service = StrategicClassificationService(provider)

        await service.classify(title="Test Title", abstract="Test Abstract")

        provider.complete_json.assert_awaited_once()
        call_args = provider.complete_json.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test Title" in prompt
        assert "Test Abstract" in prompt

    async def test_classify_each_valid_bucket(self) -> None:
        for bucket in VALID_BUCKETS:
            response = _valid_llm_response()
            response["bucket"] = bucket
            provider = _make_provider(return_value=response)
            service = StrategicClassificationService(provider)

            result = await service.classify(title="Test", abstract="Abstract")

            assert result.bucket == bucket

    async def test_classify_each_valid_time_horizon(self) -> None:
        for horizon in VALID_TIME_HORIZONS:
            response = _valid_llm_response()
            response["time_horizon"] = horizon
            provider = _make_provider(return_value=response)
            service = StrategicClassificationService(provider)

            result = await service.classify(title="Test", abstract="Abstract")

            assert result.time_horizon == horizon

    async def test_classify_with_empty_abstract(self) -> None:
        provider = _make_provider()
        service = StrategicClassificationService(provider)

        result = await service.classify(title="Test", abstract="")

        assert isinstance(result, StrategicClassificationResult)

    async def test_classify_with_none_abstract(self) -> None:
        provider = _make_provider()
        service = StrategicClassificationService(provider)

        result = await service.classify(title="Test", abstract=None)

        assert isinstance(result, StrategicClassificationResult)


# ---------------------------------------------------------------------------
# StrategicClassificationService — validation errors
# ---------------------------------------------------------------------------


class TestStrategicClassificationServiceValidation:
    """Tests for response validation in StrategicClassificationService."""

    async def test_rejects_invalid_bucket(self) -> None:
        response = _valid_llm_response()
        response["bucket"] = "INVALID_BUCKET"
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="Invalid bucket"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_invalid_time_horizon(self) -> None:
        response = _valid_llm_response()
        response["time_horizon"] = "next_century"
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Tt]ime.horizon|time_horizon"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_confidence_above_one(self) -> None:
        response = _valid_llm_response()
        response["confidence"] = 1.5
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Cc]onfidence"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_confidence_below_zero(self) -> None:
        response = _valid_llm_response()
        response["confidence"] = -0.1
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Cc]onfidence"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_bucket_field(self) -> None:
        response = _valid_llm_response()
        del response["bucket"]
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_confidence_field(self) -> None:
        response = _valid_llm_response()
        del response["confidence"]
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_rationale_field(self) -> None:
        response = _valid_llm_response()
        del response["rationale"]
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_time_horizon_field(self) -> None:
        response = _valid_llm_response()
        del response["time_horizon"]
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_empty_rationale(self) -> None:
        response = _valid_llm_response()
        response["rationale"] = ""
        provider = _make_provider(return_value=response)
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Rr]ationale|[Ee]mpty"):
            await service.classify(title="Test", abstract="Abstract")


# ---------------------------------------------------------------------------
# StrategicClassificationService — LLM errors
# ---------------------------------------------------------------------------


class TestStrategicClassificationServiceLLMErrors:
    """Tests for LLM error handling in StrategicClassificationService."""

    async def test_handles_timeout_error(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Tt]imeout|timed out"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_connection_error(self) -> None:
        provider = _make_provider(side_effect=ConnectionError("Connection refused"))
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="[Cc]onnection|LLM"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_value_error(self) -> None:
        provider = _make_provider(side_effect=ValueError("Invalid JSON"))
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError, match="JSON|json|LLM"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_generic_exception(self) -> None:
        provider = _make_provider(side_effect=RuntimeError("Unexpected error"))
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError):
            await service.classify(title="Test", abstract="Abstract")

    async def test_error_includes_context(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = StrategicClassificationService(provider)

        with pytest.raises(StrategicClassificationError) as exc_info:
            await service.classify(title="Test", abstract="Abstract")

        assert exc_info.value.title == "Test"
