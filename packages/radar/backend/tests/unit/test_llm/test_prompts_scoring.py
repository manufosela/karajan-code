"""Unit tests for the scoring prompt module."""

from __future__ import annotations

from app.llm.prompts.scoring import (
    VALID_HYPE_RISKS,
    VALID_RECOMMENDED_ACTIONS,
    format_scoring_prompt,
)


class TestValidRecommendedActions:
    """Tests for the VALID_RECOMMENDED_ACTIONS constant."""

    def test_contains_expected_actions(self) -> None:
        expected = {"monitor", "investigate", "test", "discard"}
        assert VALID_RECOMMENDED_ACTIONS == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(VALID_RECOMMENDED_ACTIONS, frozenset)


class TestValidHypeRisks:
    """Tests for the VALID_HYPE_RISKS constant."""

    def test_contains_expected_risks(self) -> None:
        expected = {"low", "medium", "high"}
        assert VALID_HYPE_RISKS == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(VALID_HYPE_RISKS, frozenset)


class TestFormatScoringPrompt:
    """Tests for format_scoring_prompt helper."""

    def test_substitutes_title_and_abstract(self) -> None:
        prompt = format_scoring_prompt(
            title="Novel Aligner Materials",
            abstract="A study on shape-memory polymers for aligners.",
        )
        assert "Novel Aligner Materials" in prompt
        assert "A study on shape-memory polymers for aligners." in prompt

    def test_handles_empty_abstract(self) -> None:
        prompt = format_scoring_prompt(
            title="Some Title",
            abstract="",
        )
        assert "Some Title" in prompt
        assert "No abstract available." in prompt

    def test_handles_none_abstract(self) -> None:
        prompt = format_scoring_prompt(
            title="Some Title",
            abstract=None,
        )
        assert "Some Title" in prompt
        assert "None" not in prompt
        assert "No abstract available." in prompt

    def test_prompt_requests_json_output(self) -> None:
        prompt = format_scoring_prompt(
            title="Test",
            abstract="Test abstract",
        )
        assert "JSON" in prompt or "json" in prompt

    def test_prompt_mentions_expected_fields(self) -> None:
        prompt = format_scoring_prompt(
            title="Test",
            abstract="Test abstract",
        )
        assert "scientific_strength_score" in prompt
        assert "strategic_relevance_score" in prompt
        assert "scientific_rationale" in prompt
        assert "strategic_rationale" in prompt
        assert "recommended_action" in prompt
        assert "hype_risk" in prompt

    def test_prompt_lists_valid_actions(self) -> None:
        prompt = format_scoring_prompt(
            title="Test",
            abstract="Test abstract",
        )
        for action in VALID_RECOMMENDED_ACTIONS:
            assert action in prompt

    def test_prompt_lists_valid_hype_risks(self) -> None:
        prompt = format_scoring_prompt(
            title="Test",
            abstract="Test abstract",
        )
        for risk in VALID_HYPE_RISKS:
            assert risk in prompt

    def test_special_characters_in_inputs(self) -> None:
        prompt = format_scoring_prompt(
            title='Title with "quotes" & <tags>',
            abstract="Abstract with\nnewlines\tand\ttabs",
        )
        assert 'Title with "quotes" & <tags>' in prompt
        assert "Abstract with\nnewlines\tand\ttabs" in prompt
