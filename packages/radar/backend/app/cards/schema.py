"""Pydantic schema for a distilled card and its provenance.

A card carries five sections -- what problem it recognises, when to reach for
it, when NOT to, what it costs, and where it comes from -- because that is
what makes it usable without the original document. None of them may be
empty: a card without applicability limits is worse than no card, since a
reader cannot tell "we looked and found none" from "nobody looked".

Provenance is a separate concern from the body. The body is a document that
may have been curated by a human; provenance is what makes a particular copy
traceable back to a source, a connector and a moment in time. Cards this
engine produces are always born ``feed``: promotion to ``canon`` is human
curation, and ``for_capture`` deliberately takes no status argument so no
ingestion path can grant it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, field_validator

CardStatus = Literal["canon", "feed"]
"""``feed`` is machine-distilled and unreviewed; ``canon`` is human-curated."""

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


class Provenance(FrozenModel):
    """Where a particular copy of a card came from, and how far to trust it."""

    source: NonBlankStr
    connector: NonBlankStr
    captured_at: datetime
    status: CardStatus

    @field_validator("captured_at")
    @classmethod
    def _must_be_an_unambiguous_past_instant(cls, value: datetime) -> datetime:
        """Reject naive and future capture times.

        Instances run in different timezones, so a naive timestamp is an
        ambiguous instant rather than a convenience. A capture time in the
        future means a clock is wrong somewhere, and silently keeping it
        would poison any freshness ordering built on top.
        """
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("captured_at must carry a timezone")
        if value > datetime.now(tz=UTC):
            raise ValueError(f"captured_at is in the future: {value.isoformat()}")
        return value

    @classmethod
    def for_capture(cls, *, source: str, connector: str, captured_at: datetime) -> Provenance:
        """Build the provenance of a freshly captured document.

        There is no status argument on purpose: everything this engine
        distils is unreviewed, and only human curation moves a card to
        ``canon``.
        """
        return cls(source=source, connector=connector, captured_at=captured_at, status="feed")


class DistilledCard(FrozenModel):
    """A card body together with the provenance that makes it traceable."""

    body: CardBody
    provenance: Provenance
