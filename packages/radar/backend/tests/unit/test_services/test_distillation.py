"""Tests for turning an analysed item into a distilled card.

The interesting cases are not the happy path. They are the ways a model can
answer plausibly and still leave you without a usable card: declining
without a reason, claiming a card and supplying something else, or writing
sections it cannot support.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.cards.schema import DistilledCard
from app.profiles.renderer import PromptRenderer
from app.profiles.schema import RadarProfile
from app.services.distillation import DistillationError, DistillationService, NotDistilled
from tests.unit.test_profiles.test_schema import _minimal_profile_dict

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _card_fields() -> dict[str, str]:
    return {
        "title": "Logical clocks & happened-before",
        "problem_signature": "Events across processes need an order and wall clocks disagree.",
        "reach_for_it_when": "- Two or more writers produce events whose causal order matters.",
        "do_not_reach_for_it_when": "- A single writer already totally orders the events.",
        "trade_offs": "- Vector clocks cost metadata per event that must be carried and pruned.",
        "canonical_source": "Leslie Lamport, CACM, 1978.",
    }


def _service(reply: object) -> DistillationService:
    """A service whose provider answers with *reply*."""
    provider = AsyncMock()
    provider.complete_json = AsyncMock(
        side_effect=reply if isinstance(reply, Exception) else None,
        return_value=None if isinstance(reply, Exception) else reply,
    )
    renderer = PromptRenderer(RadarProfile.model_validate(_minimal_profile_dict()))
    return DistillationService(provider, renderer)


async def _distill(service: DistillationService) -> DistilledCard | NotDistilled:
    return await service.distill(
        title="Logical clocks",
        abstract="Events across processes need a consistent order.",
        source="https://example.org/lamport-1978",
        connector="rss",
    )


# ---------------------------------------------------------------------------
# A card comes back
# ---------------------------------------------------------------------------


class TestACardComesBack:
    async def test_returns_a_card_with_its_provenance(self) -> None:
        service = _service({"distillable": True, "reason": None, "card": _card_fields()})

        result = await _distill(service)

        assert isinstance(result, DistilledCard)
        assert result.body.title.startswith("Logical clocks")
        assert result.provenance.source == "https://example.org/lamport-1978"
        assert result.provenance.connector == "rss"

    async def test_the_card_is_born_in_feed(self) -> None:
        """Promotion to canon is human curation; the pipeline cannot grant it."""
        service = _service({"distillable": True, "reason": None, "card": _card_fields()})

        result = await _distill(service)

        assert isinstance(result, DistilledCard)
        assert result.provenance.status == "feed"

    async def test_sends_the_document_to_the_model(self) -> None:
        service = _service({"distillable": True, "reason": None, "card": _card_fields()})

        await _distill(service)

        prompt = service._provider.complete_json.await_args.args[0]
        assert "Logical clocks" in prompt
        assert "https://example.org/lamport-1978" in prompt


# ---------------------------------------------------------------------------
# No card comes back
# ---------------------------------------------------------------------------


class TestNoCardComesBack:
    async def test_a_declined_document_is_a_result_not_an_error(self) -> None:
        """An announcement has no card in it, and that is a fine outcome."""
        service = _service(
            {
                "distillable": False,
                "reason": "an announcement of a product, with no reusable lesson",
                "card": None,
            }
        )

        result = await _distill(service)

        assert isinstance(result, NotDistilled)
        assert "announcement" in result.reason

    async def test_declining_without_a_reason_is_an_error(self) -> None:
        """Silence is indistinguishable from a malformed answer."""
        service = _service({"distillable": False, "reason": None, "card": None})

        with pytest.raises(DistillationError, match="without saying why"):
            await _distill(service)

    async def test_a_missing_verdict_counts_as_declining(self) -> None:
        service = _service({"reason": "nothing reusable here"})

        assert isinstance(await _distill(service), NotDistilled)


# ---------------------------------------------------------------------------
# The model answers plausibly and uselessly
# ---------------------------------------------------------------------------


class TestPlausibleButUnusable:
    async def test_rejects_a_card_that_claims_to_exist_and_does_not(self) -> None:
        service = _service({"distillable": True, "card": "a lovely card, honestly"})

        with pytest.raises(DistillationError, match="supplied str"):
            await _distill(service)

    async def test_rejects_a_card_missing_its_limits(self) -> None:
        fields = _card_fields()
        del fields["do_not_reach_for_it_when"]
        service = _service({"distillable": True, "card": fields})

        with pytest.raises(DistillationError, match="do_not_reach_for_it_when"):
            await _distill(service)

    async def test_rejects_limits_filled_in_with_filler(self) -> None:
        """The format's own defence: a section saying nothing is not a section."""
        fields = _card_fields()
        fields["do_not_reach_for_it_when"] = "N/A"
        service = _service({"distillable": True, "card": fields})

        with pytest.raises(DistillationError, match="placeholder"):
            await _distill(service)


# ---------------------------------------------------------------------------
# The model cannot be reached
# ---------------------------------------------------------------------------


class TestTheModelCannotBeReached:
    async def test_wraps_a_provider_failure(self) -> None:
        service = _service(ConnectionError("the model is down"))

        with pytest.raises(DistillationError, match="could not be asked"):
            await _distill(service)

    async def test_keeps_the_title_on_the_error_for_the_log(self) -> None:
        service = _service(ValueError("no JSON object found"))

        with pytest.raises(DistillationError) as raised:
            await _distill(service)

        assert raised.value.title == "Logical clocks"
