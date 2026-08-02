"""Reading and writing distilled cards as markdown.

The canonical form of a card is a markdown document with a level-one title
and five level-two sections in a fixed order -- the shape karajan-code's
``library/`` corpus already indexes. Anything else is a format drift and is
reported as such: an unexpected heading, a missing section or a reordering
fails loudly instead of being quietly absorbed, so a source format that
moves under us says what moved.

Writing is the exact inverse of reading: a card read from the corpus and
written back out is the same file, byte for byte.

Provenance travels in YAML frontmatter ahead of the body, so a card file
stays a readable markdown document. The corpus indexer chunks whatever it
finds and does not recognise frontmatter, which is why ``render_card_body``
exists next to ``render_card``: what goes into the corpus is the body, and
provenance is carried alongside it.
"""

from __future__ import annotations

import re

import yaml
from pydantic import ValidationError

from app.cards.schema import CardBody, DistilledCard, Provenance

# Field name paired with the heading it is written under, in document order.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("problem_signature", "Problem signature"),
    ("reach_for_it_when", "Reach for it when"),
    ("do_not_reach_for_it_when", "Do NOT reach for it when"),
    ("trade_offs", "Trade-offs"),
    ("canonical_source", "Canonical source"),
)

CANONICAL_HEADINGS: tuple[str, ...] = tuple(heading for _, heading in SECTIONS)

_FRONTMATTER_FENCE = "---"

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
            leaves one empty, carries an unknown heading, orders the sections
            differently, or opens with frontmatter -- which would mean
            silently dropping the provenance it carries.
    """
    if markdown.lstrip().startswith(_FRONTMATTER_FENCE):
        raise CardFormatError("document starts with frontmatter; use parse_card to read provenance too")

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


def parse_card(markdown: str) -> DistilledCard:
    """Read a card and its provenance from a markdown document.

    Args:
        markdown: The document, opening with YAML frontmatter.

    Returns:
        The validated card.

    Raises:
        CardFormatError: If the frontmatter is absent, unparseable or does
            not describe a complete provenance, or if the body is invalid.
    """
    frontmatter, body = _split_frontmatter(markdown)

    try:
        data = yaml.safe_load(frontmatter)
    except yaml.YAMLError as exc:
        raise CardFormatError(f"invalid frontmatter: {exc}") from exc

    if not isinstance(data, dict):
        raise CardFormatError(f"frontmatter must be a mapping, got {type(data).__name__}")

    try:
        provenance = Provenance.model_validate(data)
    except ValidationError as exc:
        raise CardFormatError(f"invalid provenance: {exc}") from exc

    return DistilledCard(body=parse_card_body(body), provenance=provenance)


def render_card_body(body: CardBody) -> str:
    """Write a card body as markdown, in the canonical layout.

    This is what goes into the corpus: the document an agent reads, with no
    metadata mixed into it.
    """
    parts = [f"# {body.title}\n"]
    parts.extend(f"\n## {heading}\n\n{getattr(body, field)}\n" for field, heading in SECTIONS)
    return "".join(parts)


def render_card(card: DistilledCard) -> str:
    """Write a card as markdown with its provenance in YAML frontmatter."""
    provenance = card.provenance.model_dump()
    provenance["captured_at"] = card.provenance.captured_at.isoformat()

    frontmatter = yaml.safe_dump(provenance, default_flow_style=False, sort_keys=True, allow_unicode=True)

    return f"{_FRONTMATTER_FENCE}\n{frontmatter}{_FRONTMATTER_FENCE}\n{render_card_body(card.body)}"


def _split_frontmatter(markdown: str) -> tuple[str, str]:
    """Separate the YAML frontmatter from the body that follows it.

    Raises:
        CardFormatError: If the document does not open with a fenced
            frontmatter block, or the fence is never closed.
    """
    lines = markdown.splitlines(keepends=True)

    if not lines or lines[0].rstrip("\n") != _FRONTMATTER_FENCE:
        raise CardFormatError("card has no provenance frontmatter")

    for index, line in enumerate(lines[1:], start=1):
        if line.rstrip("\n") == _FRONTMATTER_FENCE:
            return "".join(lines[1:index]), "".join(lines[index + 1 :])

    raise CardFormatError("frontmatter is never closed")


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
