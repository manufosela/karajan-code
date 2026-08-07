"""Pulling a JSON object out of a model's reply.

Every provider that asks a model for structured output faces the same
problem: the payload is JSON, but the envelope is whatever the model felt
like writing. Small local models wrap their JSON in prose or code fences
despite instructions to the contrary, and hosted ones do it too when the
request carries no output schema.

The rule here is forgiving about the envelope and strict about the payload:
strip what surrounds the object, then fail loudly if what is left is not a
usable one.
"""

from __future__ import annotations

import json
from typing import Any


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model response.

    Accepts a bare object, one wrapped in a Markdown code fence, or one
    embedded in prose. Braces inside string literals are not mistaken for
    structure.

    Args:
        text: The raw model output.

    Returns:
        The decoded object.

    Raises:
        ValueError: If no JSON object is present, or it is malformed.
    """
    candidate = _strip_code_fence(text.strip())

    try:
        return _as_object(json.loads(candidate))
    except json.JSONDecodeError:
        pass

    span = _find_object_span(candidate)
    if span is None:
        raise ValueError(f"no JSON object found in model response: {text[:200]!r}")

    start, end = span
    try:
        return _as_object(json.loads(candidate[start:end]))
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed JSON in model response: {exc}") from exc


def _as_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object, got {type(value).__name__}")
    return value


def _strip_code_fence(text: str) -> str:
    """Remove a surrounding ``` fence, with or without a language tag."""
    if not text.startswith("```"):
        return text

    without_open = text[3:]
    newline = without_open.find("\n")
    if newline == -1:
        return text

    body = without_open[newline + 1 :]
    closing = body.rfind("```")
    return body[:closing].strip() if closing != -1 else body.strip()


def _find_object_span(text: str) -> tuple[int, int] | None:
    """Locate the first balanced ``{...}`` span, ignoring braces in strings.

    A brace inside a string literal is punctuation, not structure, so the
    scan skips over literals wholesale rather than tracking quote state
    brace by brace.
    """
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    index = start

    while index < len(text):
        char = text[index]

        if char == '"':
            index = _end_of_string_literal(text, index)
            continue

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return start, index + 1

        index += 1

    return None


def _end_of_string_literal(text: str, opening: int) -> int:
    """Return the index just past the string literal opening at *opening*.

    An unterminated literal yields the end of the text, which leaves the
    caller with an unbalanced span -- the correct outcome, since a reply
    that opens a string and never closes it has no complete object in it.
    """
    index = opening + 1

    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return index + 1
        index += 1

    return index
