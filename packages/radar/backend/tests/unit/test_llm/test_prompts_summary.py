"""Unit tests for the executive summary prompt module."""

from __future__ import annotations

from app.llm.prompts.summary import (
    REQUIRED_SUMMARY_FIELDS,
    format_summary_prompt,
)


class TestRequiredSummaryFields:
    """Tests for the REQUIRED_SUMMARY_FIELDS constant."""

    def test_contains_expected_fields(self) -> None:
        expected = {"summary_en", "summary_es", "key_findings", "implications"}
        assert REQUIRED_SUMMARY_FIELDS == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(REQUIRED_SUMMARY_FIELDS, frozenset)

    def test_has_four_fields(self) -> None:
        assert len(REQUIRED_SUMMARY_FIELDS) == 4


class TestFormatSummaryPrompt:
    """Tests for format_summary_prompt helper."""

    def test_substitutes_title_and_abstract(self) -> None:
        prompt = format_summary_prompt(
            title="Novel Aligner Materials",
            abstract="A study on shape-memory polymers for aligners.",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 7, "strategic_relevance_score": 8},
        )
        assert "Novel Aligner Materials" in prompt
        assert "A study on shape-memory polymers for aligners." in prompt

    def test_substitutes_themes(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Abstract",
            themes=["biomaterials", "clear_aligners"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 6},
        )
        assert "biomaterials" in prompt
        assert "clear_aligners" in prompt

    def test_substitutes_scores(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 7, "strategic_relevance_score": 9},
        )
        assert "7" in prompt
        assert "9" in prompt

    def test_handles_empty_abstract(self) -> None:
        prompt = format_summary_prompt(
            title="Some Title",
            abstract="",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "Some Title" in prompt
        assert "No abstract available." in prompt

    def test_handles_none_abstract(self) -> None:
        prompt = format_summary_prompt(
            title="Some Title",
            abstract=None,
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "Some Title" in prompt
        assert "None" not in prompt
        assert "No abstract available." in prompt

    def test_handles_empty_themes(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Abstract",
            themes=[],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "No themes assigned" in prompt

    def test_handles_empty_scores(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Abstract",
            themes=["biomaterials"],
            scores={},
        )
        assert "No scores available" in prompt

    def test_prompt_requests_json_output(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Test abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "JSON" in prompt or "json" in prompt

    def test_prompt_mentions_expected_fields(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Test abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "summary_en" in prompt
        assert "summary_es" in prompt
        assert "key_findings" in prompt
        assert "implications" in prompt

    def test_prompt_mentions_bilingual(self) -> None:
        prompt = format_summary_prompt(
            title="Test",
            abstract="Test abstract",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert "English" in prompt
        assert "Spanish" in prompt or "español" in prompt.lower()

    def test_special_characters_in_inputs(self) -> None:
        prompt = format_summary_prompt(
            title='Title with "quotes" & <tags>',
            abstract="Abstract with\nnewlines\tand\ttabs",
            themes=["biomaterials"],
            scores={"scientific_strength_score": 5, "strategic_relevance_score": 5},
        )
        assert 'Title with "quotes" & <tags>' in prompt
        assert "Abstract with\nnewlines\tand\ttabs" in prompt
