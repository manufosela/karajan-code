"""Tests for the body of a distilled card.

The body is what an agent reads to decide without opening the source. The
schema exists to make one thing impossible: a card that looks complete but
says nothing where its limits should be.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.cards.schema import CardBody
from tests.unit.test_cards.samples import SECTION_FIELDS, body_dict


def test_accepts_a_complete_body() -> None:
    body = CardBody.model_validate(body_dict())

    assert body.title.startswith("Logical clocks")
    assert body.canonical_source.startswith("Leslie Lamport")


@pytest.mark.parametrize("field", SECTION_FIELDS)
def test_rejects_a_missing_section(field: str) -> None:
    data = body_dict()
    del data[field]

    with pytest.raises(ValidationError, match=field):
        CardBody.model_validate(data)


@pytest.mark.parametrize("field", SECTION_FIELDS)
@pytest.mark.parametrize("empty", ["", "   ", "\n\n"])
def test_rejects_an_empty_section(field: str, empty: str) -> None:
    data = body_dict()
    data[field] = empty

    with pytest.raises(ValidationError, match=field):
        CardBody.model_validate(data)


@pytest.mark.parametrize("filler", ["N/A", "n/a", "TBD", "TODO", "None", "-", "Not applicable"])
def test_rejects_a_placeholder_instead_of_limits(filler: str) -> None:
    """A card without applicability limits is worse than no card at all.

    The engine must fail loudly rather than emit a section whose content
    says nothing, because a reader cannot tell "we found no limits" from
    "nobody looked".
    """
    data = body_dict()
    data["do_not_reach_for_it_when"] = filler

    with pytest.raises(ValidationError, match="placeholder"):
        CardBody.model_validate(data)


def test_keeps_a_section_that_merely_mentions_a_filler_word() -> None:
    """Only a section that is *entirely* filler is rejected."""
    data = body_dict()
    data["do_not_reach_for_it_when"] = "- None of this applies when a single writer orders the events."

    assert CardBody.model_validate(data).do_not_reach_for_it_when.startswith("- None of this")


def test_rejects_a_missing_title() -> None:
    data = body_dict()
    del data["title"]

    with pytest.raises(ValidationError, match="title"):
        CardBody.model_validate(data)


def test_rejects_unknown_fields() -> None:
    """An extra field means the format drifted; say so instead of dropping it."""
    data = body_dict()
    data["confidence"] = "high"

    with pytest.raises(ValidationError):
        CardBody.model_validate(data)


def test_is_immutable_once_built() -> None:
    body = CardBody.model_validate(body_dict())

    with pytest.raises(ValidationError):
        body.title = "something else"  # type: ignore[misc]


def test_strips_surrounding_blank_lines_from_sections() -> None:
    data = body_dict()
    data["trade_offs"] = "\n\n- Vector clocks cost metadata.\n\n"

    body = CardBody.model_validate(data)

    assert body.trade_offs == "- Vector clocks cost metadata."


def test_keeps_line_breaks_inside_a_section() -> None:
    """Section text is never re-wrapped: the format is wrapped by hand."""
    data = body_dict()
    data["trade_offs"] = (
        "- Vector clocks cost O(nodes) metadata per event\n  that must be carried and pruned."
    )

    body = CardBody.model_validate(data)

    assert body.trade_offs.endswith("per event\n  that must be carried and pruned.")
