"""Anthropic LLM provider.

Two of Claude's API rules shape the request this file builds, and both fail
at runtime rather than at import, so they are handled here rather than left
to be discovered in a production run.

Sampling parameters are rejected. Current Claude models return a 400 for
``temperature``, ``top_p`` and ``top_k``; behaviour is steered by the prompt
and by the effort level instead. ``BaseLLMProvider`` still carries a
``temperature`` argument because the OpenAI and Ollama providers use it, so
a caller that sets one here gets a warning rather than a dropped parameter
nobody hears about.

The system prompt is a request field, not a message. Sent as a message it
would be an ordinary user turn with none of its authority.

A third rule shapes the reply rather than the request: it can be unusable
while the HTTP call succeeded. A safety decline comes back as a 200 with an
empty body, and a reply that ran out of room comes back truncated. Both are
raised as themselves, because reading the text off either one yields
something worse than an error -- an empty string, or half an answer that
looks whole.
"""

from __future__ import annotations

import os
import time
from typing import Any

from anthropic import AsyncAnthropic

from app.core.logging import get_logger
from app.llm import default_registry
from app.llm.base import BaseLLMProvider, LLMResponse, Usage
from app.llm.json_parsing import extract_json

logger = get_logger(__name__)


class AnthropicProviderError(RuntimeError):
    """Base for replies that arrived successfully and cannot be used."""


class RequestDeclinedError(AnthropicProviderError):
    """Raised when Claude's safety classifiers declined the request."""


class TruncatedResponseError(AnthropicProviderError):
    """Raised when the reply hit the output budget before finishing."""


_DEFAULT_MODEL = "claude-opus-5"
_DEFAULT_EFFORT = "low"
_VALID_EFFORTS = frozenset({"low", "medium", "high", "xhigh", "max"})

# The value BaseLLMProvider declares. A caller leaving it alone is taking the
# default rather than asking for anything, so only a change is worth warning
# about.
_UNSET_TEMPERATURE = 0.2


class AnthropicProvider(BaseLLMProvider):
    """Chat provider backed by the Anthropic Messages API."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        effort: str = _DEFAULT_EFFORT,
    ) -> None:
        """Configure the provider.

        Args:
            api_key: Falls back to ANTHROPIC_API_KEY.
            model: Falls back to ANTHROPIC_MODEL, then to a current default.
            effort: How hard the model works per request. This is the main
                cost lever, and classification-shaped work does not need
                much, so the default is deliberately low.

        Raises:
            ValueError: If *effort* is not one the API accepts.
        """
        if effort not in _VALID_EFFORTS:
            raise ValueError(f"unknown effort '{effort}'; expected one of {sorted(_VALID_EFFORTS)}")

        self.model = model or os.getenv("ANTHROPIC_MODEL") or _DEFAULT_MODEL
        self.effort = effort
        self._client = AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY", ""))

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = _UNSET_TEMPERATURE,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Send a prompt and return a free-text response.

        Args:
            prompt: The user turn.
            system_prompt: Sent as the request's system field.
            temperature: Accepted for interface compatibility and **not
                sent** -- the API rejects it. A value other than the default
                is logged so the caller knows it did not apply.
            max_tokens: Ceiling on the reply. Thinking draws on the same
                budget, so leave room.

        Returns:
            The reply, with token usage and latency. Thinking is on by
            default on current models, so a reply routinely carries blocks
            that are not text; those are skipped.

        Raises:
            RequestDeclinedError: If safety classifiers declined the request.
            TruncatedResponseError: If the reply hit *max_tokens*.
            ValueError: If a finished reply carries no text at all.
        """
        if temperature != _UNSET_TEMPERATURE:
            logger.warning(
                "temperature_ignored",
                requested=temperature,
                reason="the Anthropic API rejects sampling parameters; steer with the prompt",
            )

        request = self._build_request(prompt, system_prompt=system_prompt, max_tokens=max_tokens)
        return await self._send(request)

    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        """Send a prompt and return structured JSON.

        The pipeline calls this without a schema, because the default
        prompts carry their own schema in the prompt text, so the object has
        to be read back out of whatever the reply wraps it in.

        Args:
            prompt: The user turn.
            system_prompt: Sent as the request's system field.
            schema: Reserved for constraining the reply; not yet applied.

        Returns:
            The decoded object.

        Raises:
            ValueError: If the reply contains no usable JSON object.
        """
        response = await self.complete(prompt, system_prompt=system_prompt)
        return extract_json(response.content)

    def _build_request(
        self,
        prompt: str,
        *,
        system_prompt: str | None,
        max_tokens: int,
    ) -> dict[str, Any]:
        """Assemble one Messages API request."""
        request: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "output_config": {"effort": self.effort},
        }
        if system_prompt:
            request["system"] = system_prompt
        return request

    async def _send(self, request: dict[str, Any]) -> LLMResponse:
        """Perform one call and turn the reply into an LLMResponse."""
        start = time.perf_counter()
        message = await self._client.messages.create(**request)
        latency_ms = (time.perf_counter() - start) * 1000

        _reject_unusable(message)

        return LLMResponse(
            content=_text_of(message),
            model=message.model,
            usage=Usage(
                prompt_tokens=message.usage.input_tokens,
                completion_tokens=message.usage.output_tokens,
            ),
            latency_ms=latency_ms,
        )


def _reject_unusable(message: Any) -> None:
    """Fail on a reply that arrived intact and cannot be used.

    Raises:
        RequestDeclinedError: The safety classifiers declined the request.
        TruncatedResponseError: The reply ran out of output budget.
    """
    if message.stop_reason == "refusal":
        raise RequestDeclinedError(
            "Anthropic declined the request; its safety classifiers stopped it before any output"
        )

    if message.stop_reason == "max_tokens":
        raise TruncatedResponseError(
            "reply hit max_tokens and is incomplete; raise max_tokens or lower the effort, "
            "because thinking draws on the same budget as the answer"
        )


def _text_of(message: Any) -> str:
    """Join the text blocks of a reply, skipping everything else.

    Raises:
        ValueError: If the reply contains no text block at all.
    """
    blocks = [block.text for block in message.content if getattr(block, "type", None) == "text"]

    if not blocks:
        raise ValueError(
            f"Anthropic returned no text (stop_reason={message.stop_reason!r}, "
            f"{len(message.content)} block(s))"
        )

    return "\n".join(blocks)


# ---------------------------------------------------------------------------
# Auto-register in the default registry
# ---------------------------------------------------------------------------
default_registry.register("anthropic", AnthropicProvider)
