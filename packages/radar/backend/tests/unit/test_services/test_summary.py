"""Unit tests for the executive summary service."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.llm.base import BaseLLMProvider
from app.services.summary import (
    SummaryError,
    SummaryResult,
    SummaryService,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid_llm_response() -> dict:
    """Return a valid summary response dict."""
    return {
        "summary_en": "This study demonstrates significant improvements in clear aligner treatment outcomes. The novel approach shows promise for reducing treatment duration.",
        "summary_es": "Este estudio demuestra mejoras significativas en los resultados del tratamiento con alineadores transparentes. El nuevo enfoque muestra potencial para reducir la duración del tratamiento.",
        "key_findings": [
            "Treatment duration reduced by 30% with the new protocol.",
            "Patient compliance improved significantly with the modified design.",
        ],
        "implications": [
            "The organization could adopt this protocol to reduce average treatment times.",
            "Modified aligner design may improve patient retention rates.",
        ],
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

class TestSummaryResult:
    """Tests for SummaryResult dataclass."""

    def test_create(self) -> None:
        result = SummaryResult(
            summary_en="English summary.",
            summary_es="Resumen en español.",
            key_findings=["Finding one.", "Finding two."],
            implications=["Implication one.", "Implication two."],
        )
        assert result.summary_en == "English summary."
        assert result.summary_es == "Resumen en español."
        assert result.key_findings == ["Finding one.", "Finding two."]
        assert result.implications == ["Implication one.", "Implication two."]

    def test_frozen(self) -> None:
        result = SummaryResult(
            summary_en="English summary.",
            summary_es="Resumen en español.",
            key_findings=["Finding one."],
            implications=["Implication one."],
        )
        with pytest.raises(AttributeError):
            result.summary_en = "Changed"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# SummaryService — happy path
# ---------------------------------------------------------------------------

class TestSummaryServiceHappyPath:
    """Tests for successful summary generation."""

    async def test_summarize_returns_summary_result(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Orthodontic Innovations",
            abstract="A study on clear aligners.",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 7, "strategic_relevance_score": 8},
        )

        assert isinstance(result, SummaryResult)

    async def test_summarize_maps_fields_correctly(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Test",
            abstract="Abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 7, "strategic_relevance_score": 8},
        )

        assert result.summary_en == _valid_llm_response()["summary_en"]
        assert result.summary_es == _valid_llm_response()["summary_es"]
        assert result.key_findings == _valid_llm_response()["key_findings"]
        assert result.implications == _valid_llm_response()["implications"]

    async def test_summarize_calls_provider_with_prompt(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        await service.summarize(
            title="Test Title",
            abstract="Test Abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 7, "strategic_relevance_score": 8},
        )

        provider.complete_json.assert_awaited_once()
        call_args = provider.complete_json.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test Title" in prompt
        assert "Test Abstract" in prompt

    async def test_summarize_with_empty_abstract(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Test",
            abstract="",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )

        assert isinstance(result, SummaryResult)

    async def test_summarize_with_none_abstract(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Test",
            abstract=None,
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )

        assert isinstance(result, SummaryResult)

    async def test_summarize_with_empty_themes(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Test",
            abstract="Abstract",
            themes=[],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )

        assert isinstance(result, SummaryResult)

    async def test_summarize_with_empty_scores(self) -> None:
        provider = _make_provider()
        service = SummaryService(provider)

        result = await service.summarize(
            title="Test",
            abstract="Abstract",
            themes=["biomaterials"],
            scores={},
        )

        assert isinstance(result, SummaryResult)


# ---------------------------------------------------------------------------
# SummaryService — validation errors
# ---------------------------------------------------------------------------

class TestSummaryServiceValidation:
    """Tests for response validation in SummaryService."""

    async def test_rejects_empty_summary_en(self) -> None:
        response = _valid_llm_response()
        response["summary_en"] = ""
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="summary_en"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_whitespace_summary_en(self) -> None:
        response = _valid_llm_response()
        response["summary_en"] = "   "
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="summary_en"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_empty_summary_es(self) -> None:
        response = _valid_llm_response()
        response["summary_es"] = ""
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="summary_es"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_whitespace_summary_es(self) -> None:
        response = _valid_llm_response()
        response["summary_es"] = "  \t  "
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="summary_es"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_empty_key_findings_list(self) -> None:
        response = _valid_llm_response()
        response["key_findings"] = []
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="key_findings"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_empty_implications_list(self) -> None:
        response = _valid_llm_response()
        response["implications"] = []
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="implications"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_empty_string_in_key_findings(self) -> None:
        response = _valid_llm_response()
        response["key_findings"] = ["Valid finding.", ""]
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="key_findings"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_empty_string_in_implications(self) -> None:
        response = _valid_llm_response()
        response["implications"] = ["Valid implication.", "   "]
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="implications"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_non_list_key_findings(self) -> None:
        response = _valid_llm_response()
        response["key_findings"] = "not a list"
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="key_findings"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_non_list_implications(self) -> None:
        response = _valid_llm_response()
        response["implications"] = "not a list"
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="implications"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_rejects_missing_required_fields(self) -> None:
        response = {"summary_en": "Only English summary."}
        provider = _make_provider(return_value=response)
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="[Mm]issing"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )


# ---------------------------------------------------------------------------
# SummaryService — LLM errors
# ---------------------------------------------------------------------------

class TestSummaryServiceLLMErrors:
    """Tests for LLM error handling in SummaryService."""

    async def test_handles_timeout_error(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="[Tt]imeout|timed out"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_handles_connection_error(self) -> None:
        provider = _make_provider(side_effect=ConnectionError("Connection refused"))
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="[Cc]onnection|LLM"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_handles_value_error_from_malformed_json(self) -> None:
        provider = _make_provider(side_effect=ValueError("Invalid JSON"))
        service = SummaryService(provider)

        with pytest.raises(SummaryError, match="JSON|json|LLM"):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_handles_generic_exception(self) -> None:
        provider = _make_provider(side_effect=RuntimeError("Unexpected error"))
        service = SummaryService(provider)

        with pytest.raises(SummaryError):
            await service.summarize(
                title="Test", abstract="Abstract",
                themes=["biomaterials"], scores={"scientific_strength_score": 5},
            )

    async def test_error_includes_context(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = SummaryService(provider)

        with pytest.raises(SummaryError) as exc_info:
            await service.summarize(
                title="Test Title",
                abstract="Abstract",
                themes=["biomaterials"],
                scores={"scientific_strength_score": 5},
            )

        assert exc_info.value.title == "Test Title"
