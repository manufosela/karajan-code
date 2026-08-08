"""Tests for card provenance and the card that carries it.

Provenance answers two questions about a copy of a card: where it came from,
and how far to trust it. The second one is why ``canon`` must be unreachable
from an ingestion path -- a machine-distilled card claiming curated status
would make the whole corpus unreadable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.cards.schema import DistilledCard, Provenance
from tests.unit.test_cards.samples import body_dict, provenance_dict


def test_declares_where_the_card_came_from() -> None:
    provenance = Provenance.model_validate(provenance_dict())

    assert provenance.source == "https://example.org/lamport-1978"
    assert provenance.connector == "rss"
    assert provenance.captured_at == datetime(2026, 7, 1, 9, 0, tzinfo=UTC)
    assert provenance.status == "feed"


@pytest.mark.parametrize("field", ["source", "connector", "captured_at", "status"])
def test_requires_every_field(field: str) -> None:
    data = provenance_dict()
    del data[field]

    with pytest.raises(ValidationError, match=field):
        Provenance.model_validate(data)


@pytest.mark.parametrize("field", ["source", "connector"])
def test_rejects_a_blank_origin(field: str) -> None:
    data = provenance_dict()
    data[field] = "   "

    with pytest.raises(ValidationError, match=field):
        Provenance.model_validate(data)


def test_rejects_an_unknown_status() -> None:
    data = provenance_dict()
    data["status"] = "verified"

    with pytest.raises(ValidationError, match="status"):
        Provenance.model_validate(data)


def test_rejects_a_naive_capture_time() -> None:
    """Instances run in different timezones; an ambiguous instant is a bug."""
    data = provenance_dict()
    data["captured_at"] = "2026-07-01T09:00:00"

    with pytest.raises(ValidationError, match="timezone"):
        Provenance.model_validate(data)


def test_rejects_a_capture_time_in_the_future() -> None:
    """A clock is wrong somewhere; keeping it would poison freshness order."""
    data = provenance_dict()
    data["captured_at"] = (datetime.now(tz=UTC) + timedelta(days=1)).isoformat()

    with pytest.raises(ValidationError, match="future"):
        Provenance.model_validate(data)


def test_accepts_a_capture_time_in_another_timezone() -> None:
    data = provenance_dict()
    data["captured_at"] = "2026-07-01T11:00:00+02:00"

    assert Provenance.model_validate(data).captured_at == datetime(2026, 7, 1, 9, 0, tzinfo=UTC)


def test_a_capture_is_born_in_feed() -> None:
    """Promotion to canon is human curation; the engine cannot grant it.

    ``for_capture`` is the constructor the pipeline uses, and it takes no
    status argument -- so there is no code path from an ingested document to
    a canon card.
    """
    provenance = Provenance.for_capture(
        source="https://example.org/lamport-1978",
        connector="rss",
        captured_at=datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
    )

    assert provenance.status == "feed"


def test_canon_is_reachable_only_by_reading_an_existing_card() -> None:
    """A curated card already declaring canon keeps it when read back."""
    data = provenance_dict()
    data["status"] = "canon"

    assert Provenance.model_validate(data).status == "canon"


def test_is_immutable_once_built() -> None:
    provenance = Provenance.model_validate(provenance_dict())

    with pytest.raises(ValidationError):
        provenance.status = "canon"  # type: ignore[misc]


def test_a_distilled_card_carries_body_and_provenance() -> None:
    card = DistilledCard.model_validate({"body": body_dict(), "provenance": provenance_dict()})

    assert card.body.title.startswith("Logical clocks")
    assert card.provenance.connector == "rss"


def test_a_distilled_card_requires_provenance() -> None:
    """The body alone is a document; only provenance makes it traceable."""
    with pytest.raises(ValidationError, match="provenance"):
        DistilledCard.model_validate({"body": body_dict()})


def test_a_distilled_card_requires_a_valid_body() -> None:
    body = body_dict()
    body["do_not_reach_for_it_when"] = "N/A"

    with pytest.raises(ValidationError, match="placeholder"):
        DistilledCard.model_validate({"body": body, "provenance": provenance_dict()})
