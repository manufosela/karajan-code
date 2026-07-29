"""Tests for the Ollama LLM provider."""

from __future__ import annotations

import httpx
import pytest
import respx

from app.llm.base import LLMResponse
from app.llm.ollama_provider import OllamaProvider, extract_json

BASE_URL = "http://localhost:11434"
CHAT_URL = f"{BASE_URL}/api/chat"


def _chat_response(content: str) -> dict:
    return {
        "model": "llama3.1",
        "created_at": "2026-07-29T10:00:00Z",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "prompt_eval_count": 26,
        "eval_count": 42,
    }


@pytest.fixture
def provider() -> OllamaProvider:
    return OllamaProvider(base_url=BASE_URL, model="llama3.1")


# ---------------------------------------------------------------------------
# JSON extraction -- the part that matters with small local models
# ---------------------------------------------------------------------------


class TestExtractJson:
    def test_parses_plain_json(self) -> None:
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_parses_json_with_surrounding_whitespace(self) -> None:
        assert extract_json('  \n {"a": 1} \n ') == {"a": 1}

    def test_unwraps_a_fenced_json_block(self) -> None:
        raw = 'Here you go:\n```json\n{"a": 1}\n```\nHope that helps.'

        assert extract_json(raw) == {"a": 1}

    def test_unwraps_an_unlabelled_fenced_block(self) -> None:
        raw = '```\n{"a": 1}\n```'

        assert extract_json(raw) == {"a": 1}

    def test_extracts_an_object_buried_in_prose(self) -> None:
        raw = 'Sure! The answer is {"a": 1} — let me know if you need more.'

        assert extract_json(raw) == {"a": 1}

    def test_handles_nested_objects(self) -> None:
        raw = 'Result: {"a": {"b": [1, 2]}, "c": "}"} done'

        assert extract_json(raw) == {"a": {"b": [1, 2]}, "c": "}"}

    def test_ignores_braces_inside_strings(self) -> None:
        raw = '{"note": "use {curly} braces"}'

        assert extract_json(raw) == {"note": "use {curly} braces"}

    def test_raises_when_there_is_no_json(self) -> None:
        with pytest.raises(ValueError, match="no JSON object"):
            extract_json("I am afraid I cannot do that.")

    def test_raises_on_malformed_json(self) -> None:
        with pytest.raises(ValueError):
            extract_json('{"a": }')


# ---------------------------------------------------------------------------
# complete()
# ---------------------------------------------------------------------------


class TestComplete:
    @respx.mock
    async def test_returns_an_llm_response(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response("Hello there.")))

        result = await provider.complete("Say hello")

        assert isinstance(result, LLMResponse)
        assert result.content == "Hello there."
        assert result.model == "llama3.1"

    @respx.mock
    async def test_reports_token_usage(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response("hi")))

        result = await provider.complete("Say hello")

        assert result.usage.prompt_tokens == 26
        assert result.usage.completion_tokens == 42
        assert result.usage.total_tokens == 68

    @respx.mock
    async def test_sends_the_system_prompt_first(self, provider: OllamaProvider) -> None:
        route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response("ok")))

        await provider.complete("Question", system_prompt="Be terse.")

        messages = route.calls.last.request.read().decode()
        assert '"system"' in messages
        assert "Be terse." in messages

    @respx.mock
    async def test_disables_streaming(self, provider: OllamaProvider) -> None:
        """A streamed response would not parse as a single JSON body."""
        route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response("ok")))

        await provider.complete("Question")

        assert '"stream":false' in route.calls.last.request.read().decode()

    @respx.mock
    async def test_raises_on_http_error(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(return_value=httpx.Response(500, text="boom"))

        with pytest.raises(httpx.HTTPStatusError):
            await provider.complete("Question")

    @respx.mock
    async def test_raises_a_connection_error_when_ollama_is_down(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(side_effect=httpx.ConnectError("refused"))

        with pytest.raises(ConnectionError, match="Ollama"):
            await provider.complete("Question")


# ---------------------------------------------------------------------------
# complete_json()
# ---------------------------------------------------------------------------


class TestCompleteJson:
    @respx.mock
    async def test_returns_a_parsed_object(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response('{"bucket": "core"}')))

        result = await provider.complete_json("Classify this")

        assert result == {"bucket": "core"}

    @respx.mock
    async def test_recovers_from_a_chatty_model(self, provider: OllamaProvider) -> None:
        """Local models often wrap JSON in prose despite being told not to."""
        content = 'Certainly!\n```json\n{"bucket": "core"}\n```'
        respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response(content)))

        result = await provider.complete_json("Classify this")

        assert result == {"bucket": "core"}

    @respx.mock
    async def test_requests_json_format(self, provider: OllamaProvider) -> None:
        route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response('{"a": 1}')))

        await provider.complete_json("Classify this")

        assert '"format":"json"' in route.calls.last.request.read().decode()

    @respx.mock
    async def test_appends_the_schema_when_given(self, provider: OllamaProvider) -> None:
        route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response('{"a": 1}')))

        await provider.complete_json("Classify", schema={"type": "object"})

        assert "type" in route.calls.last.request.read().decode()

    @respx.mock
    async def test_raises_when_the_model_returns_no_json(self, provider: OllamaProvider) -> None:
        respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=_chat_response("I cannot.")))

        with pytest.raises(ValueError, match="no JSON object"):
            await provider.complete_json("Classify this")


# ---------------------------------------------------------------------------
# Configuration and registration
# ---------------------------------------------------------------------------


class TestConfiguration:
    def test_defaults_to_the_local_ollama_port(self) -> None:
        assert OllamaProvider().base_url == "http://localhost:11434"

    def test_strips_a_trailing_slash_from_the_base_url(self) -> None:
        provider = OllamaProvider(base_url="http://ollama:11434/")

        assert provider.base_url == "http://ollama:11434"

    def test_is_registered_under_the_name_ollama(self) -> None:
        from app.llm import default_registry

        assert "ollama" in default_registry.registered_names
