"""Tests for LLM provider registry and get_provider factory."""

from __future__ import annotations

import pytest

from app.llm import LLMProviderRegistry, get_provider
from app.llm.base import BaseLLMProvider, LLMResponse, Usage


# ---------------------------------------------------------------------------
# Concrete mock for registry tests
# ---------------------------------------------------------------------------


class FakeProvider(BaseLLMProvider):
    async def complete(self, prompt, **kwargs):
        return LLMResponse(
            content="fake", model="fake-v1", usage=Usage(0, 0), latency_ms=0
        )

    async def complete_json(self, prompt, **kwargs):
        return {}


class AnotherProvider(BaseLLMProvider):
    async def complete(self, prompt, **kwargs):
        return LLMResponse(
            content="another", model="another-v1", usage=Usage(0, 0), latency_ms=0
        )

    async def complete_json(self, prompt, **kwargs):
        return {}


# ---------------------------------------------------------------------------
# LLMProviderRegistry
# ---------------------------------------------------------------------------


class TestLLMProviderRegistry:
    def test_register_and_get(self) -> None:
        registry = LLMProviderRegistry()
        registry.register("fake", FakeProvider)
        provider = registry.get("fake")
        assert isinstance(provider, FakeProvider)

    def test_get_unknown_raises_key_error(self) -> None:
        registry = LLMProviderRegistry()
        with pytest.raises(KeyError, match="not registered"):
            registry.get("nonexistent")

    def test_case_insensitive_lookup(self) -> None:
        registry = LLMProviderRegistry()
        registry.register("FakeProvider", FakeProvider)
        provider = registry.get("fakeprovider")
        assert isinstance(provider, FakeProvider)
        provider2 = registry.get("FAKEPROVIDER")
        assert isinstance(provider2, FakeProvider)

    def test_overwrite_replaces_provider(self) -> None:
        registry = LLMProviderRegistry()
        registry.register("fake", FakeProvider)
        registry.register("fake", AnotherProvider)
        # Should now return the new provider
        provider = registry.get("fake")
        assert isinstance(provider, AnotherProvider)

    def test_registered_names(self) -> None:
        registry = LLMProviderRegistry()
        registry.register("alpha", FakeProvider)
        registry.register("beta", AnotherProvider)
        names = registry.registered_names
        assert "alpha" in names
        assert "beta" in names
        assert len(names) == 2


# ---------------------------------------------------------------------------
# get_provider factory function
# ---------------------------------------------------------------------------


class TestGetProvider:
    def test_get_provider_from_module_registry(self) -> None:
        """get_provider uses the module-level default_registry."""
        from app.llm import default_registry

        default_registry.register("test_fake", FakeProvider)
        provider = get_provider("test_fake")
        assert isinstance(provider, FakeProvider)

    def test_get_provider_unknown_raises(self) -> None:
        with pytest.raises(KeyError):
            get_provider("definitely_not_registered_xyz")
