"""Tests for writing a card body back to markdown.

The reference card from karajan-code ships as a fixture, and the strongest
statement this suite can make about the format is here: parse it, render it,
and get the same file back byte for byte. The destination format leads and
this code follows it, not the reverse.
"""

from __future__ import annotations

from pathlib import Path

from app.cards.markdown import parse_card_body, render_card_body
from app.cards.schema import CardBody
from tests.unit.test_cards.samples import MINIMAL_CARD, MINIMAL_SECTIONS, body_dict, card_markdown

REFERENCE_CARD = Path(__file__).resolve().parents[2] / "fixtures" / "library" / "logical-clocks-lamport.md"


# ---------------------------------------------------------------------------
# The reference card from karajan-code
# ---------------------------------------------------------------------------


def test_the_reference_card_parses() -> None:
    body = parse_card_body(REFERENCE_CARD.read_text(encoding="utf-8"))

    assert body.title == "Logical clocks & happened-before (Lamport, 1978)"
    assert body.problem_signature.startswith("Events across processes/services need")
    assert "CAUSAL order matters" in body.reach_for_it_when
    assert "A single writer (or a single database)" in body.do_not_reach_for_it_when
    assert "Lamport clocks are one counter" in body.trade_offs
    assert body.canonical_source.startswith("Leslie Lamport,")


def test_the_reference_card_survives_a_round_trip_unchanged() -> None:
    """Byte for byte: anything less means we are rewriting the format."""
    original = REFERENCE_CARD.read_text(encoding="utf-8")

    assert render_card_body(parse_card_body(original)) == original


def test_the_reference_card_keeps_its_hand_wrapped_lines() -> None:
    """The reference card is wrapped by hand, not greedily to a column.

    Re-wrapping would produce a different file from the one karajan-code
    ships, which is exactly what the round trip above forbids.
    """
    body = parse_card_body(REFERENCE_CARD.read_text(encoding="utf-8"))

    assert (
        "- Two or more writers/emitters produce events whose CAUSAL order matters\n" in body.reach_for_it_when
    )


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def test_renders_the_canonical_layout() -> None:
    assert render_card_body(parse_card_body(MINIMAL_CARD)) == MINIMAL_CARD


def test_a_body_built_by_hand_renders_the_same_layout() -> None:
    """A card the engine assembles is indistinguishable from a curated one."""
    body = CardBody(
        title="Some pattern",
        problem_signature="The thing goes wrong.",
        reach_for_it_when="- The thing is about to go wrong.",
        do_not_reach_for_it_when="- The thing cannot go wrong here.",
        trade_offs="- It costs something.",
        canonical_source='Someone, "A Paper", 1978.',
    )

    assert render_card_body(body) == MINIMAL_CARD


def test_renders_multi_line_sections_verbatim() -> None:
    listed = (
        MINIMAL_SECTIONS[0],
        ("Reach for it when", "- First reason, which runs\n  onto a second line.\n- Second reason."),
        *MINIMAL_SECTIONS[2:],
    )
    original = card_markdown(listed)

    assert render_card_body(parse_card_body(original)) == original


def test_rendering_is_idempotent() -> None:
    body = CardBody.model_validate(body_dict())

    once = render_card_body(body)

    assert render_card_body(parse_card_body(once)) == once


def test_the_rendered_document_ends_with_a_single_newline() -> None:
    """Corpus files are plain markdown; no trailing blank line to diff over."""
    rendered = render_card_body(CardBody.model_validate(body_dict()))

    assert rendered.endswith(".\n")
    assert not rendered.endswith("\n\n")
