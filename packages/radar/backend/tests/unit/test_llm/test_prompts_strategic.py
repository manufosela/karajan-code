"""Unit tests for the strategic bucket classification prompt module."""

from __future__ import annotations

from app.llm.prompts.strategic import (
    VALID_BUCKETS,
    VALID_TIME_HORIZONS,
    format_strategic_prompt,
)


class TestValidBuckets:
    """Tests for the VALID_BUCKETS constant."""

    def test_contains_expected_buckets(self) -> None:
        expected = {
            "core_aligner_tech",
            "emerging_materials",
            "ai_digital_workflow",
            "biomechanics_research",
            "clinical_evidence",
            "regulatory_compliance",
            "competitive_intelligence",
        }
        assert VALID_BUCKETS == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(VALID_BUCKETS, frozenset)

    def test_has_seven_buckets(self) -> None:
        assert len(VALID_BUCKETS) == 7


class TestValidTimeHorizons:
    """Tests for the VALID_TIME_HORIZONS constant."""

    def test_contains_expected_horizons(self) -> None:
        expected = {"immediate", "short_term", "medium_term", "long_term"}
        assert VALID_TIME_HORIZONS == expected

    def test_is_frozenset(self) -> None:
        assert isinstance(VALID_TIME_HORIZONS, frozenset)

    def test_has_four_horizons(self) -> None:
        assert len(VALID_TIME_HORIZONS) == 4


class TestFormatStrategicPrompt:
    """Tests for format_strategic_prompt helper."""

    def test_substitutes_title_and_abstract(self) -> None:
        prompt = format_strategic_prompt(
            title="Novel Aligner Material Study",
            abstract="A study on thermoformed PETG aligners.",
        )
        assert "Novel Aligner Material Study" in prompt
        assert "A study on thermoformed PETG aligners." in prompt

    def test_handles_empty_abstract(self) -> None:
        prompt = format_strategic_prompt(title="Some Title", abstract="")
        assert "Some Title" in prompt
        assert "No abstract available." in prompt

    def test_handles_none_abstract(self) -> None:
        prompt = format_strategic_prompt(title="Some Title", abstract=None)
        assert "Some Title" in prompt
        assert "None" not in prompt
        assert "No abstract available." in prompt

    def test_prompt_requests_json_output(self) -> None:
        prompt = format_strategic_prompt(title="Test", abstract="Test abstract")
        assert "JSON" in prompt or "json" in prompt

    def test_prompt_mentions_expected_fields(self) -> None:
        prompt = format_strategic_prompt(title="Test", abstract="Test abstract")
        assert "bucket" in prompt
        assert "confidence" in prompt
        assert "rationale" in prompt
        assert "time_horizon" in prompt

    def test_prompt_lists_valid_buckets(self) -> None:
        prompt = format_strategic_prompt(title="Test", abstract="Test abstract")
        for bucket in VALID_BUCKETS:
            assert bucket in prompt

    def test_prompt_lists_valid_time_horizons(self) -> None:
        prompt = format_strategic_prompt(title="Test", abstract="Test abstract")
        for horizon in VALID_TIME_HORIZONS:
            assert horizon in prompt

    def test_special_characters_in_inputs(self) -> None:
        prompt = format_strategic_prompt(
            title='Title with "quotes" & <tags>',
            abstract="Abstract with\nnewlines\tand\ttabs",
        )
        assert 'Title with "quotes" & <tags>' in prompt
        assert "Abstract with\nnewlines\tand\ttabs" in prompt
