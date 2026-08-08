"""Pydantic schema for the body of a distilled card.

A card carries five sections -- what problem it recognises, when to reach for
it, when NOT to, what it costs, and where it comes from -- because that is
what makes it usable without the original document. None of them may be
empty: a card without applicability limits is worse than no card, since a
reader cannot tell "we looked and found none" from "nobody looked".
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

# Values a language model reaches for when it has nothing to say. Matched
# against the whole section, so a section that merely mentions one of these
# in a sentence is untouched.
_PLACEHOLDERS = frozenset(
    {
        "-",
        "--",
        "?",
        "n/a",
        "n.a.",
        "na",
        "none",
        "not applicable",
        "nothing",
        "tbd",
        "todo",
        "unknown",
    }
)


def _reject_placeholder(value: str) -> str:
    """Reject a section whose entire content says nothing.

    Raises:
        ValueError: If the section is one of the known filler values.
    """
    if value.strip().rstrip(".").casefold() in _PLACEHOLDERS:
        raise ValueError(f"section is a placeholder, not content: {value!r}")
    return value


SectionText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
    AfterValidator(_reject_placeholder),
]
"""The text of one card section: never blank, never filler, never re-wrapped."""

NonBlankStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class FrozenModel(BaseModel):
    """Base for every card component: immutable once built."""

    model_config = ConfigDict(frozen=True, extra="forbid", validate_assignment=True)


class CardBody(FrozenModel):
    """The document part of a card, in the shape the corpus consumes.

    Section text is stored exactly as written, including its line breaks: the
    reference cards are wrapped by hand rather than greedily to a column, so
    re-wrapping on the way out would rewrite the format we are following.
    """

    title: NonBlankStr
    problem_signature: SectionText
    reach_for_it_when: SectionText
    do_not_reach_for_it_when: SectionText
    trade_offs: SectionText
    canonical_source: SectionText
