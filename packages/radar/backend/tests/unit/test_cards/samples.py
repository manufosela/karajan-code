"""Sample cards shared by the card tests.

Kept in one place so every test file works from the same valid card and each
test only has to say what it breaks about it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.cards.schema import Provenance

SECTION_FIELDS = (
    "problem_signature",
    "reach_for_it_when",
    "do_not_reach_for_it_when",
    "trade_offs",
    "canonical_source",
)


def body_dict() -> dict[str, Any]:
    """A valid card body, as the base for mutation tests."""
    return {
        "title": "Logical clocks & happened-before (Lamport, 1978)",
        "problem_signature": "Events across processes need a consistent order, and wall clocks disagree.",
        "reach_for_it_when": "- Two or more writers produce events whose CAUSAL order matters.",
        "do_not_reach_for_it_when": "- A single writer already totally orders the events.",
        "trade_offs": "- Vector clocks cost O(nodes) metadata per event.",
        "canonical_source": 'Leslie Lamport, "Time, Clocks, and the Ordering of Events", CACM, 1978.',
    }


def provenance_dict() -> dict[str, Any]:
    """A valid provenance, as the base for mutation tests."""
    return {
        "source": "https://example.org/lamport-1978",
        "connector": "rss",
        "captured_at": "2026-07-01T09:00:00Z",
        "status": "feed",
    }


MINIMAL_SECTIONS = (
    ("Problem signature", "The thing goes wrong."),
    ("Reach for it when", "- The thing is about to go wrong."),
    ("Do NOT reach for it when", "- The thing cannot go wrong here."),
    ("Trade-offs", "- It costs something."),
    ("Canonical source", 'Someone, "A Paper", 1978.'),
)


def card_markdown(
    sections: tuple[tuple[str, str], ...] = MINIMAL_SECTIONS,
    *,
    title: str = "Some pattern",
) -> str:
    """Assemble a card document from its sections, in the order given."""
    blocks = "".join(f"## {heading}\n\n{text}\n\n" for heading, text in sections)
    return f"# {title}\n\n{blocks}".rstrip("\n") + "\n"


MINIMAL_CARD = card_markdown()

FRONTMATTER = """\
---
captured_at: '2026-07-01T09:00:00+00:00'
connector: rss
source: https://example.org/a-paper
status: feed
---
"""
"""The frontmatter matching ``captured_provenance``, as it is written out."""


def captured_provenance() -> Provenance:
    """The provenance of a document captured by the rss connector."""
    return Provenance.for_capture(
        source="https://example.org/a-paper",
        connector="rss",
        captured_at=datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
    )
