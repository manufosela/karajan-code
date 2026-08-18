"""Turning an analysed item into a distilled card.

This is the step that produces what the karajan family corpus consumes: a
card a reader can decide from without opening the source. It runs only for
instances that opted into the contract, and it is the only pipeline step
allowed to conclude that an item is not worth a card at all.

That refusal is the point rather than a shortcoming. A model asked for six
sections will produce six sections, so a document that teaches nothing
reusable would otherwise yield a card that looks complete and says nothing.
Declining is a result the caller handles, not an error, and it carries the
reason so a later reader can tell "we looked and there was nothing" from
"the run failed".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.cards.schema import CardBody, DistilledCard, Provenance
from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider
from app.profiles.active import get_prompt_renderer
from app.profiles.renderer import PromptRenderer

logger = get_logger(__name__)


class DistillationError(Exception):
    """Raised when distilling fails for a reason that is not the document."""

    def __init__(self, message: str, *, title: str = "") -> None:
        super().__init__(message)
        self.title = title


@dataclass(frozen=True)
class NotDistilled:
    """An item the model declined to turn into a card, and why.

    A perfectly good outcome: an announcement, a summary, or a finding whose
    limits cannot be established has no card in it.
    """

    reason: str


class DistillationService:
    """Distils analysed items into cards for the family corpus.

    Args:
        provider: The LLM provider to ask.
        renderer: Prompt renderer supplying the domain context. Defaults to
            the renderer bound to the active Radar Profile.
    """

    def __init__(
        self,
        provider: BaseLLMProvider,
        renderer: PromptRenderer | None = None,
    ) -> None:
        self._provider = provider
        self._renderer = renderer if renderer is not None else get_prompt_renderer()

    async def distill(
        self,
        *,
        title: str,
        abstract: str | None,
        source: str,
        connector: str,
    ) -> DistilledCard | NotDistilled:
        """Turn one document into a card, or report why it has none.

        Args:
            title: The document's title.
            abstract: Its abstract, if it has one.
            source: Where the document came from, for the provenance.
            connector: Which connector brought it in.

        Returns:
            The card, or a NotDistilled carrying the model's reason.

        Raises:
            DistillationError: If the call fails, or the reply is neither a
                usable card nor an intelligible refusal.
        """
        prompt = self._renderer.render(
            "distillation",
            title=title,
            abstract=abstract or "No abstract available.",
            source_reference=source,
        )

        try:
            reply = await self._provider.complete_json(prompt)
        except Exception as exc:
            logger.error("distillation_llm_error", title=title, error=str(exc))
            raise DistillationError(f"the model could not be asked: {exc}", title=title) from exc

        return self._read(reply, title=title, source=source, connector=connector)

    def _read(
        self,
        reply: dict[str, Any],
        *,
        title: str,
        source: str,
        connector: str,
    ) -> DistilledCard | NotDistilled:
        """Turn the model's answer into a card or a refusal.

        Raises:
            DistillationError: If the answer is neither.
        """
        if not reply.get("distillable", False):
            reason = reply.get("reason")
            if not reason:
                raise DistillationError(
                    "the model declined without saying why, which is indistinguishable "
                    "from a malformed answer",
                    title=title,
                )
            logger.info("item_not_distillable", title=title, reason=reason)
            return NotDistilled(reason=str(reason))

        body = reply.get("card")
        if not isinstance(body, dict):
            raise DistillationError(
                f"the model claimed a card and supplied {type(body).__name__}", title=title
            )

        try:
            card_body = CardBody.model_validate(body)
        except ValidationError as exc:
            # The card format rejects empty and filler sections, so this is
            # the model having written a card it could not actually support.
            raise DistillationError(f"the card does not hold together: {exc}", title=title) from exc

        return DistilledCard(
            body=card_body,
            provenance=Provenance.for_capture(
                source=source,
                connector=connector,
                captured_at=datetime.now(tz=UTC),
            ),
        )
