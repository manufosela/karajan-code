"""Unit tests for the classification service."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.llm.base import BaseLLMProvider
from app.services.classification import (
    ClassificationError,
    ClassificationResult,
    ClassificationService,
    ThemeScore,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid_llm_response() -> dict:
    """Return a valid classification response dict."""
    return {
        "themes": [
            {"name": "orthodontics", "confidence": 0.9},
            {"name": "biomechanics", "confidence": 0.6},
        ],
        "primary_theme": "orthodontics",
        "keywords": ["aligners", "tooth movement", "malocclusion"],
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

class TestThemeScore:
    """Tests for ThemeScore dataclass."""

    def test_create(self) -> None:
        ts = ThemeScore(name="orthodontics", confidence=0.9)
        assert ts.name == "orthodontics"
        assert ts.confidence == 0.9

    def test_frozen(self) -> None:
        ts = ThemeScore(name="orthodontics", confidence=0.9)
        with pytest.raises(AttributeError):
            ts.name = "other"  # type: ignore[misc]


class TestClassificationResult:
    """Tests for ClassificationResult dataclass."""

    def test_create(self) -> None:
        themes = [ThemeScore(name="orthodontics", confidence=0.9)]
        result = ClassificationResult(
            themes=themes,
            primary_theme="orthodontics",
            keywords=["aligners"],
        )
        assert result.primary_theme == "orthodontics"
        assert len(result.themes) == 1
        assert result.keywords == ["aligners"]

    def test_frozen(self) -> None:
        result = ClassificationResult(
            themes=[ThemeScore(name="orthodontics", confidence=0.9)],
            primary_theme="orthodontics",
            keywords=["aligners"],
        )
        with pytest.raises(AttributeError):
            result.primary_theme = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ClassificationService — happy path
# ---------------------------------------------------------------------------

class TestClassificationServiceHappyPath:
    """Tests for successful classification."""

    async def test_classify_returns_classification_result(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(
            title="Orthodontic Innovations",
            abstract="A study on clear aligners.",
        )

        assert isinstance(result, ClassificationResult)

    async def test_classify_maps_themes_correctly(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract="Abstract")

        assert len(result.themes) == 2
        assert result.themes[0].name == "orthodontics"
        assert result.themes[0].confidence == 0.9
        assert result.themes[1].name == "biomechanics"
        assert result.themes[1].confidence == 0.6

    async def test_classify_sets_primary_theme(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract="Abstract")

        assert result.primary_theme == "orthodontics"

    async def test_classify_extracts_keywords(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract="Abstract")

        assert result.keywords == ["aligners", "tooth movement", "malocclusion"]

    async def test_classify_calls_provider_with_prompt(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        await service.classify(title="Test Title", abstract="Test Abstract")

        provider.complete_json.assert_awaited_once()
        call_args = provider.complete_json.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt", "")
        assert "Test Title" in prompt
        assert "Test Abstract" in prompt

    async def test_classify_single_theme(self) -> None:
        response = {
            "themes": [{"name": "materials", "confidence": 0.95}],
            "primary_theme": "materials",
            "keywords": ["3D printing", "biocompatibility", "polymers"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract="Abstract")

        assert len(result.themes) == 1
        assert result.primary_theme == "materials"

    async def test_classify_with_empty_abstract(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract="")

        assert isinstance(result, ClassificationResult)

    async def test_classify_with_none_abstract(self) -> None:
        provider = _make_provider()
        service = ClassificationService(provider)

        result = await service.classify(title="Test", abstract=None)

        assert isinstance(result, ClassificationResult)


# ---------------------------------------------------------------------------
# ClassificationService — validation errors
# ---------------------------------------------------------------------------

class TestClassificationServiceValidation:
    """Tests for response validation in ClassificationService."""

    async def test_rejects_invalid_theme_name(self) -> None:
        response = {
            "themes": [{"name": "INVALID_THEME", "confidence": 0.9}],
            "primary_theme": "INVALID_THEME",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="Invalid theme"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_confidence_above_one(self) -> None:
        response = {
            "themes": [{"name": "orthodontics", "confidence": 1.5}],
            "primary_theme": "orthodontics",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Cc]onfidence"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_confidence_below_zero(self) -> None:
        response = {
            "themes": [{"name": "orthodontics", "confidence": -0.1}],
            "primary_theme": "orthodontics",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Cc]onfidence"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_primary_theme_not_in_themes(self) -> None:
        response = {
            "themes": [{"name": "orthodontics", "confidence": 0.9}],
            "primary_theme": "biomechanics",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="primary_theme"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_themes_field(self) -> None:
        response = {
            "primary_theme": "orthodontics",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_primary_theme_field(self) -> None:
        response = {
            "themes": [{"name": "orthodontics", "confidence": 0.9}],
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_missing_keywords_field(self) -> None:
        response = {
            "themes": [{"name": "orthodontics", "confidence": 0.9}],
            "primary_theme": "orthodontics",
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Mm]issing"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_rejects_empty_themes_list(self) -> None:
        response = {
            "themes": [],
            "primary_theme": "orthodontics",
            "keywords": ["keyword1", "keyword2", "keyword3"],
        }
        provider = _make_provider(return_value=response)
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Ee]mpty|[Aa]t least"):
            await service.classify(title="Test", abstract="Abstract")


# ---------------------------------------------------------------------------
# ClassificationService — LLM errors
# ---------------------------------------------------------------------------

class TestClassificationServiceLLMErrors:
    """Tests for LLM error handling in ClassificationService."""

    async def test_handles_timeout_error(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Tt]imeout|timed out"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_connection_error(self) -> None:
        provider = _make_provider(side_effect=ConnectionError("Connection refused"))
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="[Cc]onnection|LLM"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_value_error_from_malformed_json(self) -> None:
        provider = _make_provider(side_effect=ValueError("Invalid JSON"))
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError, match="JSON|json|LLM"):
            await service.classify(title="Test", abstract="Abstract")

    async def test_handles_generic_exception(self) -> None:
        provider = _make_provider(side_effect=RuntimeError("Unexpected error"))
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError):
            await service.classify(title="Test", abstract="Abstract")

    async def test_error_includes_context(self) -> None:
        provider = _make_provider(side_effect=TimeoutError("LLM timed out"))
        service = ClassificationService(provider)

        with pytest.raises(ClassificationError) as exc_info:
            await service.classify(title="Test", abstract="Abstract")

        assert exc_info.value.title == "Test"
