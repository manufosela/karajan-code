"""Tests for pulling a JSON object out of a model reply.

Forgiving about the envelope, strict about the payload: a fence or a
sentence of prose around the object is fine, a malformed object is not.
"""

from __future__ import annotations

import pytest

from app.llm.json_parsing import extract_json

# ---------------------------------------------------------------------------


class TestExtractJson:
    def test_parses_plain_json(self) -> None:
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_parses_json_with_surrounding_whitespace(self) -> None:
        assert extract_json('  \n {"a": 1} \n ') == {"a": 1}

    def test_unwraps_a_fenced_json_block(self) -> None:
        raw = 'Here you go:\n```json\n{"a": 1}\n```\nHope that helps.'

        assert extract_json(raw) == {"a": 1}

    def test_unwraps_an_unlabelled_fenced_block(self) -> None:
        raw = '```\n{"a": 1}\n```'

        assert extract_json(raw) == {"a": 1}

    def test_extracts_an_object_buried_in_prose(self) -> None:
        raw = 'Sure! The answer is {"a": 1} — let me know if you need more.'

        assert extract_json(raw) == {"a": 1}

    def test_handles_nested_objects(self) -> None:
        raw = 'Result: {"a": {"b": [1, 2]}, "c": "}"} done'

        assert extract_json(raw) == {"a": {"b": [1, 2]}, "c": "}"}

    def test_ignores_braces_inside_strings(self) -> None:
        raw = '{"note": "use {curly} braces"}'

        assert extract_json(raw) == {"note": "use {curly} braces"}

    def test_raises_when_there_is_no_json(self) -> None:
        with pytest.raises(ValueError, match="no JSON object"):
            extract_json("I am afraid I cannot do that.")

    def test_raises_on_malformed_json(self) -> None:
        with pytest.raises(ValueError):
            extract_json('{"a": }')

    def test_raises_when_a_string_literal_is_never_closed(self) -> None:
        """A reply that opens a quote and stops has no complete object in it."""
        with pytest.raises(ValueError, match="no JSON object"):
            extract_json('{"a": "unterminated')

    def test_reads_an_object_whose_strings_contain_escaped_quotes(self) -> None:
        assert extract_json(r'{"quote": "she said \"hi\"", "b": 2}') == {
            "quote": 'she said "hi"',
            "b": 2,
        }
