"""Tests for the Anthropic provider's free-text path.

Two of Claude's API rules shape the request this provider builds, and each
has a test here because getting either wrong fails at runtime rather than
at import: sampling parameters are rejected outright, and the system prompt
is a request field rather than a message.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import anthropic
import httpx
import pytest
from anthropic.types import Message, TextBlock, Usage

from app.llm import anthropic_provider
from app.llm.anthropic_provider import (
    AnthropicProvider,
    RequestDeclinedError,
    TruncatedResponseError,
)

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


def _http_error(kind: type, status: int, message: str) -> Exception:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return kind(message, response=httpx.Response(status, request=request), body=None)


@pytest.fixture
def provider() -> AnthropicProvider:
    return AnthropicProvider(api_key="test-key", max_retries=3)


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

    async def test_joins_several_text_blocks(self, provider: AnthropicProvider) -> None:
        reply = _message()
        reply.content = [
            TextBlock(type="text", text="first"),
            TextBlock(type="text", text="second"),
        ]
        _reply_with(provider, reply)

        assert (await provider.complete("go")).content == "first\nsecond"

    async def test_skips_blocks_that_are_not_text(self, provider: AnthropicProvider) -> None:
        """Thinking is on by default, so a reply routinely opens with one."""
        reply = _message()
        reply.content = [
            TextBlock.construct(type="thinking", thinking="working on it"),
            TextBlock(type="text", text="the answer"),
        ]
        _reply_with(provider, reply)

        assert (await provider.complete("go")).content == "the answer"

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

    async def test_omits_the_system_field_when_there_is_none(self, provider: AnthropicProvider) -> None:
        call = _reply_with(provider, _message())

        await provider.complete("go")

        assert "system" not in call.await_args.kwargs

    async def test_sends_the_configured_effort(self) -> None:
        provider = AnthropicProvider(api_key="k", effort="medium")
        call = _reply_with(provider, _message())

        await provider.complete("go")

        assert call.await_args.kwargs["output_config"] == {"effort": "medium"}

    def test_an_explicit_model_wins_over_the_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-5")

        assert AnthropicProvider(api_key="k", model="claude-opus-5").model == "claude-opus-5"

    def test_reads_the_model_from_the_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-5")

        assert AnthropicProvider(api_key="k").model == "claude-sonnet-5"


# ---------------------------------------------------------------------------
# Replies that arrive with a 200 and cannot be used
# ---------------------------------------------------------------------------


class TestUnusableReplies:
    async def test_raises_when_the_request_was_declined(self, provider: AnthropicProvider) -> None:
        """A safety decline is a 200 with an empty body, not an HTTP error.

        This radar ingests PubMed and ClinicalTrials, so it meets the
        biology classifiers in the course of ordinary work.
        """
        declined = _message(stop_reason="refusal")
        declined.content = []
        _reply_with(provider, declined)

        with pytest.raises(RequestDeclinedError, match="declined"):
            await provider.complete("go")

    async def test_raises_when_the_reply_was_cut_off(self, provider: AnthropicProvider) -> None:
        """Thinking shares the max_tokens budget, so truncation is easy to hit."""
        _reply_with(provider, _message(stop_reason="max_tokens", text="half an ans"))

        with pytest.raises(TruncatedResponseError, match="max_tokens"):
            await provider.complete("go", max_tokens=16)

    async def test_raises_when_a_finished_reply_carries_no_text(self, provider: AnthropicProvider) -> None:
        empty = _message()
        empty.content = []
        _reply_with(provider, empty)

        with pytest.raises(ValueError, match="no text"):
            await provider.complete("go")

    async def test_a_truncated_reply_never_reaches_the_json_parser(self, provider: AnthropicProvider) -> None:
        """Half an object parses as malformed; saying why is more useful."""
        _reply_with(provider, _message(stop_reason="max_tokens", text='{"theme": "rob'))

        with pytest.raises(TruncatedResponseError):
            await provider.complete_json("classify")


# ---------------------------------------------------------------------------
# Retries
# ---------------------------------------------------------------------------


class TestRetries:
    async def test_retries_a_rate_limit_and_succeeds(self, provider: AnthropicProvider) -> None:
        call = _reply_with(
            provider,
            _http_error(anthropic.RateLimitError, 429, "slow down"),
            _message(text="second time"),
        )

        response = await provider.complete("go")

        assert response.content == "second time"
        assert call.await_count == 2

    async def test_gives_up_after_the_configured_attempts(self, provider: AnthropicProvider) -> None:
        errors = [_http_error(anthropic.RateLimitError, 429, "slow down") for _ in range(3)]
        call = _reply_with(provider, *errors)

        with pytest.raises(anthropic.RateLimitError):
            await provider.complete("go")

        assert call.await_count == 3

    async def test_does_not_retry_a_rejected_request(self, provider: AnthropicProvider) -> None:
        """A malformed request fails the same way however often it is sent."""
        call = _reply_with(
            provider,
            _http_error(anthropic.BadRequestError, 400, "temperature is not supported"),
            _message(),
        )

        with pytest.raises(anthropic.BadRequestError):
            await provider.complete("go")

        assert call.await_count == 1

    async def test_does_not_retry_a_declined_request(self, provider: AnthropicProvider) -> None:
        """A decline is a verdict on the content, not a passing failure."""
        declined = _message(stop_reason="refusal")
        declined.content = []
        call = _reply_with(provider, declined, _message())

        with pytest.raises(RequestDeclinedError):
            await provider.complete("go")

        assert call.await_count == 1
