"""Tests for LLM provider abstraction layer: BaseLLMProvider, LLMResponse, Usage."""

from __future__ import annotations

import pytest

from app.llm.base import BaseLLMProvider, LLMResponse, Usage


# ---------------------------------------------------------------------------
# Usage dataclass
# ---------------------------------------------------------------------------


class TestUsage:
    def test_construction(self) -> None:
        usage = Usage(prompt_tokens=100, completion_tokens=50)
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50

    def test_total_tokens(self) -> None:
        usage = Usage(prompt_tokens=100, completion_tokens=50)
        assert usage.total_tokens == 150

    def test_zero_tokens(self) -> None:
        usage = Usage(prompt_tokens=0, completion_tokens=0)
        assert usage.total_tokens == 0


# ---------------------------------------------------------------------------
# LLMResponse dataclass
# ---------------------------------------------------------------------------


class TestLLMResponse:
    def test_construction(self) -> None:
        usage = Usage(prompt_tokens=10, completion_tokens=20)
        resp = LLMResponse(content="hello", model="gpt-4", usage=usage, latency_ms=123.4)
        assert resp.content == "hello"
        assert resp.model == "gpt-4"
        assert resp.usage is usage
        assert resp.latency_ms == 123.4

    def test_usage_accessible(self) -> None:
        usage = Usage(prompt_tokens=5, completion_tokens=15)
        resp = LLMResponse(content="ok", model="claude-3", usage=usage, latency_ms=50.0)
        assert resp.usage.prompt_tokens == 5
        assert resp.usage.completion_tokens == 15
        assert resp.usage.total_tokens == 20


# ---------------------------------------------------------------------------
# BaseLLMProvider ABC
# ---------------------------------------------------------------------------


class TestBaseLLMProviderABC:
    def test_cannot_instantiate_directly(self) -> None:
        with pytest.raises(TypeError):
            BaseLLMProvider()  # type: ignore[abstract]

    def test_cannot_instantiate_partial_implementation(self) -> None:
        class PartialProvider(BaseLLMProvider):
            async def complete(self, prompt, **kwargs):
                return LLMResponse(
                    content="x", model="m", usage=Usage(0, 0), latency_ms=0
                )
            # missing complete_json

        with pytest.raises(TypeError):
            PartialProvider()  # type: ignore[abstract]


# ---------------------------------------------------------------------------
# Concrete mock provider
# ---------------------------------------------------------------------------


class MockLLMProvider(BaseLLMProvider):
    """Concrete implementation for testing."""

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        return LLMResponse(
            content=f"response to: {prompt}",
            model="mock-model",
            usage=Usage(prompt_tokens=len(prompt), completion_tokens=10),
            latency_ms=1.0,
        )

    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        return {"answer": prompt}


class TestConcreteProvider:
    def test_can_instantiate(self) -> None:
        provider = MockLLMProvider()
        assert isinstance(provider, BaseLLMProvider)

    @pytest.mark.asyncio
    async def test_complete_returns_llm_response(self) -> None:
        provider = MockLLMProvider()
        resp = await provider.complete("hello world")
        assert isinstance(resp, LLMResponse)
        assert resp.content == "response to: hello world"
        assert resp.model == "mock-model"
        assert resp.usage.prompt_tokens == len("hello world")
        assert resp.usage.completion_tokens == 10
        assert resp.latency_ms == 1.0

    @pytest.mark.asyncio
    async def test_complete_with_kwargs(self) -> None:
        provider = MockLLMProvider()
        resp = await provider.complete(
            "test", system_prompt="sys", temperature=0.5, max_tokens=100
        )
        assert isinstance(resp, LLMResponse)

    @pytest.mark.asyncio
    async def test_complete_json_returns_dict(self) -> None:
        provider = MockLLMProvider()
        result = await provider.complete_json("what?", schema={"type": "object"})
        assert isinstance(result, dict)
        assert result == {"answer": "what?"}
