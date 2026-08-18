"""Tests for carrying provenance in YAML frontmatter.

A card file is a markdown document with its provenance ahead of the body.
The body is what goes into the corpus; the frontmatter is what says where
that body came from, and it never leaks into the text an agent reads.
"""

from __future__ import annotations

import pytest

from app.cards.markdown import (
    CardFormatError,
    parse_card,
    parse_card_body,
    render_card,
    render_card_body,
)
from app.cards.schema import DistilledCard
from tests.unit.test_cards.samples import FRONTMATTER, MINIMAL_CARD, captured_provenance


def _card() -> DistilledCard:
    return DistilledCard(body=parse_card_body(MINIMAL_CARD), provenance=captured_provenance())


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def test_reads_a_card_with_its_provenance() -> None:
    card = parse_card(FRONTMATTER + MINIMAL_CARD)

    assert card.body.title == "Some pattern"
    assert card.provenance.source == "https://example.org/a-paper"
    assert card.provenance.connector == "rss"
    assert card.provenance.status == "feed"


def test_rejects_a_card_without_frontmatter() -> None:
    """A card the radar emitted must say where it came from."""
    with pytest.raises(CardFormatError, match="provenance"):
        parse_card(MINIMAL_CARD)


def test_rejects_malformed_frontmatter() -> None:
    with pytest.raises(CardFormatError, match="frontmatter"):
        parse_card("---\nsource: [unclosed\n---\n" + MINIMAL_CARD)


def test_rejects_frontmatter_that_is_not_a_mapping() -> None:
    with pytest.raises(CardFormatError, match="mapping"):
        parse_card("---\njust a sentence\n---\n" + MINIMAL_CARD)


def test_rejects_frontmatter_left_unclosed() -> None:
    with pytest.raises(CardFormatError, match="closed"):
        parse_card("---\nsource: https://example.org/a-paper\n" + MINIMAL_CARD)


def test_rejects_frontmatter_missing_a_provenance_field() -> None:
    without_connector = FRONTMATTER.replace("connector: rss\n", "")

    with pytest.raises(CardFormatError, match="connector"):
        parse_card(without_connector + MINIMAL_CARD)


def test_rejects_a_valid_provenance_over_an_invalid_body() -> None:
    """Traceability does not excuse a card that says nothing."""
    emptied = MINIMAL_CARD.replace("- The thing cannot go wrong here.\n", "")

    with pytest.raises(CardFormatError, match="Do NOT reach for it when"):
        parse_card(FRONTMATTER + emptied)


def test_reading_a_body_refuses_a_document_carrying_frontmatter() -> None:
    """Provenance would be silently dropped; point the caller at parse_card."""
    with pytest.raises(CardFormatError, match="parse_card"):
        parse_card_body(FRONTMATTER + MINIMAL_CARD)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def test_writes_provenance_ahead_of_the_body() -> None:
    assert render_card(_card()) == FRONTMATTER + MINIMAL_CARD


def test_a_written_card_reads_back_identical() -> None:
    card = _card()

    assert parse_card(render_card(card)) == card


def test_the_body_alone_carries_no_metadata() -> None:
    """The corpus indexer chunks whatever it finds; provenance stays out.

    karajan-code's library indexer feeds every markdown file to a chunker
    that does not recognise frontmatter, so a card written into the corpus
    is rendered as body only and its provenance travels separately.
    """
    body_only = render_card_body(_card().body)

    assert body_only == MINIMAL_CARD
    assert "captured_at" not in body_only
    assert "---" not in body_only
