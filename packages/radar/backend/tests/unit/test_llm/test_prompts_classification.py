"""Unit tests for the thematic classification prompt module."""

from __future__ import annotations

from app.llm.prompts.classification import (
    VALID_THEMES,
    format_classification_prompt,
)


class TestValidThemes:
    """Tests for the VALID_THEMES constant."""

    def test_contains_expected_themes(self) -> None:
        expected = {
            "orthodontics",
            "biomechanics",
            "materials",
            "AI/digital",
            "clinical",
            "other",
        }
        assert VALID_THEMES == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(VALID_THEMES, frozenset)


class TestFormatClassificationPrompt:
    """Tests for format_classification_prompt helper."""

    def test_substitutes_title_and_abstract(self) -> None:
        prompt = format_classification_prompt(
            title="Orthodontic Innovations",
            abstract="A study on clear aligners.",
        )
        assert "Orthodontic Innovations" in prompt
        assert "A study on clear aligners." in prompt

    def test_handles_empty_abstract(self) -> None:
        prompt = format_classification_prompt(
            title="Some Title",
            abstract="",
        )
        assert "Some Title" in prompt

    def test_handles_none_abstract(self) -> None:
        prompt = format_classification_prompt(
            title="Some Title",
            abstract=None,
        )
        assert "Some Title" in prompt
        assert "None" not in prompt

    def test_prompt_requests_json_output(self) -> None:
        prompt = format_classification_prompt(
            title="Test",
            abstract="Test abstract",
        )
        assert "JSON" in prompt or "json" in prompt

    def test_prompt_mentions_expected_fields(self) -> None:
        prompt = format_classification_prompt(
            title="Test",
            abstract="Test abstract",
        )
        assert "themes" in prompt
        assert "primary_theme" in prompt
        assert "keywords" in prompt

    def test_prompt_lists_valid_themes(self) -> None:
        prompt = format_classification_prompt(
            title="Test",
            abstract="Test abstract",
        )
        for theme in VALID_THEMES:
            assert theme in prompt

    def test_special_characters_in_inputs(self) -> None:
        prompt = format_classification_prompt(
            title='Title with "quotes" & <tags>',
            abstract="Abstract with\nnewlines\tand\ttabs",
        )
        assert 'Title with "quotes" & <tags>' in prompt
        assert "Abstract with\nnewlines\tand\ttabs" in prompt
