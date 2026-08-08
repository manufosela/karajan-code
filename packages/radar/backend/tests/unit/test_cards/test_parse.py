"""Tests for reading a card body out of markdown.

Every malformed document below is a way the format can drift. The point of
the parser is that each one says what drifted, instead of yielding half a
card that looks complete.
"""

from __future__ import annotations

import pytest

from app.cards.markdown import CardFormatError, parse_card_body
from tests.unit.test_cards.samples import MINIMAL_CARD, MINIMAL_SECTIONS, card_markdown


def test_parses_every_section() -> None:
    body = parse_card_body(MINIMAL_CARD)

    assert body.title == "Some pattern"
    assert body.problem_signature == "The thing goes wrong."
    assert body.reach_for_it_when == "- The thing is about to go wrong."
    assert body.do_not_reach_for_it_when == "- The thing cannot go wrong here."
    assert body.trade_offs == "- It costs something."
    assert body.canonical_source == 'Someone, "A Paper", 1978.'


def test_keeps_line_breaks_within_a_section() -> None:
    """Hand-wrapped text survives: the parser never re-flows a paragraph."""
    wrapped = (
        ("Problem signature", "The thing goes wrong, and it does so\nacross more than one line."),
        *MINIMAL_SECTIONS[1:],
    )

    body = parse_card_body(card_markdown(wrapped))

    assert body.problem_signature == "The thing goes wrong, and it does so\nacross more than one line."


def test_keeps_a_multi_bullet_section_intact() -> None:
    listed = (
        MINIMAL_SECTIONS[0],
        ("Reach for it when", "- First reason.\n- Second reason.\n- Third reason."),
        *MINIMAL_SECTIONS[2:],
    )

    body = parse_card_body(card_markdown(listed))

    assert body.reach_for_it_when.count("\n- ") == 2


# ---------------------------------------------------------------------------
# Format drift
# ---------------------------------------------------------------------------


def test_rejects_a_card_without_a_title() -> None:
    with pytest.raises(CardFormatError, match="title"):
        parse_card_body(MINIMAL_CARD.replace("# Some pattern\n", ""))


@pytest.mark.parametrize("omitted", [heading for heading, _ in MINIMAL_SECTIONS])
def test_rejects_a_card_with_a_missing_section(omitted: str) -> None:
    remaining = tuple(section for section in MINIMAL_SECTIONS if section[0] != omitted)

    with pytest.raises(CardFormatError, match=omitted):
        parse_card_body(card_markdown(remaining))


def test_rejects_a_section_left_empty() -> None:
    emptied = tuple(
        (heading, "" if heading == "Do NOT reach for it when" else text) for heading, text in MINIMAL_SECTIONS
    )

    with pytest.raises(CardFormatError, match="Do NOT reach for it when"):
        parse_card_body(card_markdown(emptied))


def test_rejects_a_section_filled_with_a_placeholder() -> None:
    filled = tuple(
        (heading, "N/A" if heading == "Do NOT reach for it when" else text)
        for heading, text in MINIMAL_SECTIONS
    )

    with pytest.raises(CardFormatError, match="placeholder"):
        parse_card_body(card_markdown(filled))


def test_rejects_an_unknown_section() -> None:
    """An extra heading means the source format drifted; say so, do not guess."""
    with_extra = (*MINIMAL_SECTIONS, ("Confidence", "High."))

    with pytest.raises(CardFormatError, match="Confidence"):
        parse_card_body(card_markdown(with_extra))


def test_rejects_a_repeated_section() -> None:
    repeated = (*MINIMAL_SECTIONS, MINIMAL_SECTIONS[0])

    with pytest.raises(CardFormatError, match="duplicate"):
        parse_card_body(card_markdown(repeated))


def test_rejects_sections_out_of_order() -> None:
    swapped = (MINIMAL_SECTIONS[0], MINIMAL_SECTIONS[2], MINIMAL_SECTIONS[1], *MINIMAL_SECTIONS[3:])

    with pytest.raises(CardFormatError, match="order"):
        parse_card_body(card_markdown(swapped))


def test_rejects_a_document_with_two_titles() -> None:
    with pytest.raises(CardFormatError, match="more than one title"):
        parse_card_body("# First\n\n# Second\n" + MINIMAL_CARD)


def test_rejects_content_before_the_title() -> None:
    with pytest.raises(CardFormatError, match="level-one heading"):
        parse_card_body("A stray sentence.\n\n" + MINIMAL_CARD)


def test_rejects_content_between_the_title_and_the_first_section() -> None:
    strayed = MINIMAL_CARD.replace("\n## Problem signature", "A stray sentence.\n\n## Problem signature", 1)

    with pytest.raises(CardFormatError, match="between the title"):
        parse_card_body(strayed)


def test_rejects_an_empty_document() -> None:
    with pytest.raises(CardFormatError, match="level-one heading"):
        parse_card_body("")
