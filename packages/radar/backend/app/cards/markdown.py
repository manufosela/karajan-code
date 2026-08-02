"""Reading distilled cards from markdown.

The canonical form of a card is a markdown document with a level-one title
and five level-two sections in a fixed order -- the shape karajan-code's
``library/`` corpus already indexes. Anything else is a format drift and is
reported as such: an unexpected heading, a missing section or a reordering
fails loudly instead of being quietly absorbed, so a source format that
moves under us says what moved.
"""

from __future__ import annotations

import re

from pydantic import ValidationError

from app.cards.schema import CardBody

# Field name paired with the heading it is written under, in document order.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("problem_signature", "Problem signature"),
    ("reach_for_it_when", "Reach for it when"),
    ("do_not_reach_for_it_when", "Do NOT reach for it when"),
    ("trade_offs", "Trade-offs"),
    ("canonical_source", "Canonical source"),
)

CANONICAL_HEADINGS: tuple[str, ...] = tuple(heading for _, heading in SECTIONS)

_TITLE_RE = re.compile(r"^# (?P<title>.+)$")
_SECTION_RE = re.compile(r"^## (?P<heading>.+)$")


class CardFormatError(Exception):
    """Raised when a document does not describe a valid distilled card."""


def parse_card_body(markdown: str) -> CardBody:
    """Read a card body from its markdown form.

    Args:
        markdown: The document.

    Returns:
        The validated body.

    Raises:
        CardFormatError: If the document has no title, is missing a section,
            leaves one empty, carries an unknown heading, or orders the
            sections differently.
    """
    title, sections = _split_sections(markdown)
    _check_headings([heading for heading, _ in sections])

    fields = {"title": title}
    for (field, heading), (_, lines) in zip(SECTIONS, sections, strict=True):
        text = "\n".join(lines).strip()
        if not text:
            raise CardFormatError(f"section '{heading}' is empty")
        fields[field] = text

    try:
        return CardBody.model_validate(fields)
    except ValidationError as exc:
        raise CardFormatError(f"invalid card body: {exc}") from exc


def _split_sections(markdown: str) -> tuple[str, list[tuple[str, list[str]]]]:
    """Break a card body into its title and its ``## `` sections.

    Raises:
        CardFormatError: If the title is absent, repeated, or preceded by
            other content.
    """
    title: str | None = None
    sections: list[tuple[str, list[str]]] = []

    for line in markdown.splitlines():
        if match := _TITLE_RE.match(line):
            if title is not None:
                raise CardFormatError(
                    f"card has more than one title: '{title}' and '{match['title'].strip()}'"
                )
            title = match["title"].strip()
            continue

        if match := _SECTION_RE.match(line):
            sections.append((match["heading"].strip(), []))
            continue

        if sections:
            sections[-1][1].append(line)
        elif line.strip():
            if title is None:
                raise CardFormatError("card must open with a level-one heading carrying its title")
            raise CardFormatError(f"text between the title and the first section: {line.strip()!r}")

    if title is None:
        raise CardFormatError("card must open with a level-one heading carrying its title")

    return title, sections


def _check_headings(found: list[str]) -> None:
    """Verify the sections present are exactly the canonical ones, in order.

    Raises:
        CardFormatError: On an unknown, duplicated, missing or misplaced
            heading. Each case is reported separately so a drifting source
            format says what drifted.
    """
    unknown = [heading for heading in found if heading not in CANONICAL_HEADINGS]
    if unknown:
        raise CardFormatError(f"unknown section(s): {', '.join(unknown)}")

    duplicated = sorted({heading for heading in found if found.count(heading) > 1})
    if duplicated:
        raise CardFormatError(f"duplicate section(s): {', '.join(duplicated)}")

    missing = [heading for heading in CANONICAL_HEADINGS if heading not in found]
    if missing:
        raise CardFormatError(f"missing section(s): {', '.join(missing)}")

    if tuple(found) != CANONICAL_HEADINGS:
        raise CardFormatError(
            f"sections are out of order: expected {', '.join(CANONICAL_HEADINGS)}; got {', '.join(found)}"
        )
