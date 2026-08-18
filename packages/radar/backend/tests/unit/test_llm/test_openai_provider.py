"""Tests for OpenAI LLM provider implementation."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.llm.base import BaseLLMProvider, LLMResponse

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_openai_response():
    """Build a mock ChatCompletion response."""

    def _build(content: str = "Hello!", prompt_tokens: int = 10, completion_tokens: int = 5):
        choice = MagicMock()
        choice.message.content = content

        usage = MagicMock()
        usage.prompt_tokens = prompt_tokens
        usage.completion_tokens = completion_tokens

        response = MagicMock()
        response.choices = [choice]
        response.model = "gpt-4o"
        response.usage = usage
        return response

    return _build


@pytest.fixture()
def provider():
    """Create an OpenAIProvider with a dummy API key."""
    from app.llm.openai_provider import OpenAIProvider

    return OpenAIProvider(api_key="sk-test-key", model="gpt-4o")


# ---------------------------------------------------------------------------
# Construction and interface
# ---------------------------------------------------------------------------


class TestOpenAIProviderConstruction:
    def test_is_base_llm_provider(self, provider) -> None:
        assert isinstance(provider, BaseLLMProvider)

    def test_default_model(self) -> None:
        from app.llm.openai_provider import OpenAIProvider

        p = OpenAIProvider(api_key="sk-test")
        assert p.model == "gpt-4o"

    def test_custom_model(self) -> None:
        from app.llm.openai_provider import OpenAIProvider

        p = OpenAIProvider(api_key="sk-test", model="gpt-4o-mini")
        assert p.model == "gpt-4o-mini"

    def test_creates_async_client(self, provider) -> None:
        from openai import AsyncOpenAI

        assert isinstance(provider._client, AsyncOpenAI)


# ---------------------------------------------------------------------------
# complete()
# ---------------------------------------------------------------------------


class TestComplete:
    @pytest.mark.asyncio()
    async def test_returns_llm_response(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response("Test response", prompt_tokens=15, completion_tokens=8)
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        result = await provider.complete("Say hello")

        assert isinstance(result, LLMResponse)
        assert result.content == "Test response"
        assert result.model == "gpt-4o"
        assert result.usage.prompt_tokens == 15
        assert result.usage.completion_tokens == 8
        assert result.usage.total_tokens == 23
        assert result.latency_ms >= 0

    @pytest.mark.asyncio()
    async def test_passes_system_prompt(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response("response")
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        await provider.complete("user msg", system_prompt="You are helpful")

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are helpful"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "user msg"

    @pytest.mark.asyncio()
    async def test_no_system_prompt(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response("response")
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        await provider.complete("user msg")

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        messages = call_kwargs["messages"]
        assert len(messages) == 1
        assert messages[0]["role"] == "user"

    @pytest.mark.asyncio()
    async def test_passes_temperature_and_max_tokens(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response("response")
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        await provider.complete("msg", temperature=0.8, max_tokens=1024)

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        assert call_kwargs["temperature"] == 0.8
        assert call_kwargs["max_tokens"] == 1024

    @pytest.mark.asyncio()
    async def test_tracks_latency(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response("response")
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        result = await provider.complete("msg")

        assert isinstance(result.latency_ms, float)
        assert result.latency_ms >= 0


# ---------------------------------------------------------------------------
# complete_json()
# ---------------------------------------------------------------------------


class TestCompleteJson:
    @pytest.mark.asyncio()
    async def test_returns_parsed_dict(self, provider, mock_openai_response) -> None:
        json_content = json.dumps({"answer": 42, "tags": ["a", "b"]})
        mock_resp = mock_openai_response(json_content)
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        result = await provider.complete_json("Return JSON")

        assert isinstance(result, dict)
        assert result["answer"] == 42
        assert result["tags"] == ["a", "b"]

    @pytest.mark.asyncio()
    async def test_uses_json_response_format(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response('{"ok": true}')
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        await provider.complete_json("Return JSON")

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        assert call_kwargs["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio()
    async def test_includes_schema_in_prompt(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response('{"name": "test"}')
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        schema = {"type": "object", "properties": {"name": {"type": "string"}}}
        await provider.complete_json("Return JSON", schema=schema)

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        messages = call_kwargs["messages"]
        user_msg = messages[-1]["content"]
        assert "json" in user_msg.lower() or "schema" in user_msg.lower()

    @pytest.mark.asyncio()
    async def test_passes_system_prompt(self, provider, mock_openai_response) -> None:
        mock_resp = mock_openai_response('{"ok": true}')
        provider._client.chat.completions.create = AsyncMock(return_value=mock_resp)

        await provider.complete_json("query", system_prompt="Be precise")

        call_kwargs = provider._client.chat.completions.create.call_args[1]
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "Be precise"


# ---------------------------------------------------------------------------
# Rate-limit retry
# ---------------------------------------------------------------------------


class TestRateLimitRetry:
    @pytest.mark.asyncio()
    async def test_retries_on_rate_limit(self, provider, mock_openai_response) -> None:
        from openai import RateLimitError

        rate_limit_resp = MagicMock()
        rate_limit_resp.status_code = 429
        rate_limit_resp.headers = {}

        error = RateLimitError(
            message="Rate limit exceeded",
            response=rate_limit_resp,
            body=None,
        )
        success_resp = mock_openai_response("success after retry")

        provider._client.chat.completions.create = AsyncMock(side_effect=[error, success_resp])

        with patch("asyncio.sleep", new_callable=AsyncMock):
            result = await provider.complete("test")

        assert result.content == "success after retry"
        assert provider._client.chat.completions.create.call_count == 2

    @pytest.mark.asyncio()
    async def test_raises_after_max_retries(self, provider) -> None:
        from openai import RateLimitError

        rate_limit_resp = MagicMock()
        rate_limit_resp.status_code = 429
        rate_limit_resp.headers = {}

        error = RateLimitError(
            message="Rate limit exceeded",
            response=rate_limit_resp,
            body=None,
        )

        provider._client.chat.completions.create = AsyncMock(side_effect=error)

        with patch("asyncio.sleep", new_callable=AsyncMock), pytest.raises(RateLimitError):
            await provider.complete("test")


# ---------------------------------------------------------------------------
# Registry integration
# ---------------------------------------------------------------------------


class TestRegistryIntegration:
    def test_registered_as_openai(self) -> None:
        # Import the module to trigger registration
        import app.llm.openai_provider  # noqa: F401
        from app.llm import default_registry

        assert "openai" in default_registry.registered_names

    def test_get_provider_returns_openai(self) -> None:
        import app.llm.openai_provider  # noqa: F401
        from app.llm import default_registry

        provider = default_registry.get("openai", api_key="sk-test")

        from app.llm.openai_provider import OpenAIProvider

        assert isinstance(provider, OpenAIProvider)
