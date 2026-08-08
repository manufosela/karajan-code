"""Tests for the Anthropic provider's free-text path.

Two of Claude's API rules shape the request this provider builds, and each
has a test here because getting either wrong fails at runtime rather than
at import: sampling parameters are rejected outright, and the system prompt
is a request field rather than a message.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from anthropic.types import Message, TextBlock, Usage

from app.llm import anthropic_provider
from app.llm.anthropic_provider import AnthropicProvider

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _message(
    *,
    text: str = "the answer",
    stop_reason: str = "end_turn",
    model: str = "claude-opus-5",
    input_tokens: int = 11,
    output_tokens: int = 7,
) -> Message:
    """Build a reply in the shape the SDK actually returns."""
    return Message(
        id="msg_01",
        type="message",
        role="assistant",
        model=model,
        content=[TextBlock(type="text", text=text)],
        stop_reason=stop_reason,
        usage=Usage(input_tokens=input_tokens, output_tokens=output_tokens),
    )


@pytest.fixture
def provider() -> AnthropicProvider:
    return AnthropicProvider(api_key="test-key")


def _reply_with(provider: AnthropicProvider, *replies: object) -> AsyncMock:
    """Point the provider at a scripted sequence of SDK outcomes."""
    call = AsyncMock(side_effect=list(replies))
    provider._client.messages.create = call  # type: ignore[method-assign]
    return call


# ---------------------------------------------------------------------------
# complete()
# ---------------------------------------------------------------------------


class TestComplete:
    async def test_returns_an_llm_response(self, provider: AnthropicProvider) -> None:
        _reply_with(provider, _message(text="hello"))

        response = await provider.complete("say hello")

        assert response.content == "hello"
        assert response.model == "claude-opus-5"
        assert response.usage.prompt_tokens == 11
        assert response.usage.completion_tokens == 7
        assert response.latency_ms >= 0

    async def test_sends_no_sampling_parameters(self, provider: AnthropicProvider) -> None:
        """Current Claude models reject temperature, top_p and top_k with a 400."""
        call = _reply_with(provider, _message())

        await provider.complete("go", temperature=0.9)

        sent = call.await_args.kwargs
        assert "temperature" not in sent
        assert "top_p" not in sent
        assert "top_k" not in sent

    @pytest.mark.parametrize(
        ("temperature", "expect_warning"),
        [(0.9, True), (0.2, False)],
        ids=["asked-for-one", "took-the-default"],
    )
    async def test_says_so_when_a_temperature_is_dropped(
        self,
        provider: AnthropicProvider,
        monkeypatch: pytest.MonkeyPatch,
        temperature: float,
        expect_warning: bool,
    ) -> None:
        """Dropping it silently would leave the caller believing it applied."""
        _reply_with(provider, _message())
        warnings: list[str] = []
        monkeypatch.setattr(
            anthropic_provider.logger,
            "warning",
            lambda event, **kwargs: warnings.append(event),
        )

        await provider.complete("go", temperature=temperature)

        assert ("temperature_ignored" in warnings) is expect_warning

    async def test_passes_the_system_prompt_as_its_own_field(self, provider: AnthropicProvider) -> None:
        """Anthropic takes the system prompt as a request field, not a message."""
        call = _reply_with(provider, _message())

        await provider.complete("go", system_prompt="be terse")

        sent = call.await_args.kwargs
        assert sent["system"] == "be terse"
        assert sent["messages"] == [{"role": "user", "content": "go"}]

    def test_rejects_an_unknown_effort(self) -> None:
        with pytest.raises(ValueError, match="effort"):
            AnthropicProvider(api_key="k", effort="colossal")


# ---------------------------------------------------------------------------
# complete_json()
# ---------------------------------------------------------------------------
