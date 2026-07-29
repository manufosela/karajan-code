"""LLM provider abstraction layer.

Public API:
    BaseLLMProvider  – abstract base for concrete LLM providers
    LLMResponse      – generic response dataclass
    Usage            – token usage dataclass
    LLMProviderRegistry – registry for provider classes
    get_provider     – factory to obtain a provider instance by name
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.llm.base import BaseLLMProvider, LLMResponse, Usage

logger = get_logger(__name__)

__all__ = [
    "BaseLLMProvider",
    "LLMProviderRegistry",
    "LLMResponse",
    "Usage",
    "default_registry",
    "get_provider",
]


class LLMProviderRegistry:
    """Registry for LLM provider classes.

    Manages provider classes by name, provides instantiation and discovery.
    Follows the same pattern as ConnectorRegistry.
    """

    def __init__(self) -> None:
        self._providers: dict[str, type[BaseLLMProvider]] = {}

    def register(self, name: str, provider_class: type[BaseLLMProvider]) -> None:
        """Register a provider class under a given name."""
        name_lower = name.lower()
        if name_lower in self._providers:
            logger.warning("Overwriting existing LLM provider registration", name=name_lower)
        self._providers[name_lower] = provider_class
        logger.info("Registered LLM provider", name=name_lower)

    def get(self, name: str, **kwargs: Any) -> BaseLLMProvider:
        """Get a provider instance by name.

        Raises:
            KeyError: If the provider name is not registered.
        """
        name_lower = name.lower()
        if name_lower not in self._providers:
            raise KeyError(
                f"LLM provider '{name_lower}' is not registered. "
                f"Available: {list(self._providers.keys())}"
            )
        return self._providers[name_lower](**kwargs)

    @property
    def registered_names(self) -> list[str]:
        """Return list of registered provider names."""
        return list(self._providers.keys())


# Module-level default registry instance
default_registry = LLMProviderRegistry()


def get_provider(name: str, **kwargs: Any) -> BaseLLMProvider:
    """Factory function: get a provider instance from the default registry."""
    return default_registry.get(name, **kwargs)
