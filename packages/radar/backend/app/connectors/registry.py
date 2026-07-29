"""Connector registry for managing and discovering research data connectors."""

from __future__ import annotations

from typing import Any

from app.connectors.arxiv import ArXivConnector
from app.connectors.base import BaseConnector
from app.core.logging import get_logger

logger = get_logger(__name__)


class ConnectorRegistry:
    """Registry for research data connectors.

    Manages connector classes by name, provides instantiation and discovery.
    """

    def __init__(self) -> None:
        self._connectors: dict[str, type[BaseConnector]] = {}

    def register(self, name: str, connector_class: type[BaseConnector]) -> None:
        """Register a connector class under a given name.

        Args:
            name: Unique name for the connector (e.g., "pubmed", "arxiv").
            connector_class: The connector class to register.
        """
        name_lower = name.lower()
        if name_lower in self._connectors:
            logger.warning("Overwriting existing connector registration", name=name_lower)
        self._connectors[name_lower] = connector_class
        logger.info("Registered connector", name=name_lower)

    def get(self, name: str, **kwargs: Any) -> BaseConnector:
        """Get a connector instance by name.

        Args:
            name: Name of the registered connector.
            **kwargs: Extra keyword arguments passed to the connector constructor.

        Returns:
            An instance of the requested connector.

        Raises:
            KeyError: If the connector name is not registered.
        """
        name_lower = name.lower()
        if name_lower not in self._connectors:
            raise KeyError(
                f"Connector '{name_lower}' is not registered. Available: {list(self._connectors.keys())}"
            )
        return self._connectors[name_lower](**kwargs)

    def get_all_enabled(self, sources: list[Any]) -> list[BaseConnector]:
        """Get connector instances for all enabled sources that have a registered connector.

        Auto-discovers connectors by matching source.name (case-insensitive) against
        registered connector names.

        Args:
            sources: List of Source objects. Each must have 'name' (str), 'enabled' (bool),
                     and optionally 'config' (dict) attributes.

        Returns:
            List of instantiated connector objects for enabled sources.
        """
        connectors: list[BaseConnector] = []
        for source in sources:
            if not getattr(source, "enabled", True):
                logger.debug("Skipping disabled source", name=getattr(source, "name", "unknown"))
                continue

            source_name = getattr(source, "name", "").lower()
            if source_name not in self._connectors:
                logger.debug("No connector registered for source", name=source_name)
                continue

            try:
                config = getattr(source, "config", None) or {}
                # Concrete connectors take only `config`; BaseConnector's own
                # signature is not what is being called here.
                connector = self._connectors[source_name](config=config)  # type: ignore[call-arg]
                connectors.append(connector)
                logger.info("Instantiated connector for source", name=source_name)
            except Exception as e:
                logger.error("Failed to instantiate connector", name=source_name, error=str(e))

        return connectors

    @property
    def registered_names(self) -> list[str]:
        """Return list of registered connector names."""
        return list(self._connectors.keys())


def create_default_registry() -> ConnectorRegistry:
    """Create and return the default registry with all built-in connectors registered."""
    from app.connectors.clinical_trials import ClinicalTrialsConnector
    from app.connectors.crossref import CrossrefConnector
    from app.connectors.pubmed import PubMedConnector
    from app.connectors.rss import RssConnector
    from app.connectors.semantic_scholar import SemanticScholarConnector

    registry = ConnectorRegistry()
    registry.register("pubmed", PubMedConnector)
    registry.register("arxiv", ArXivConnector)
    registry.register("clinical_trials", ClinicalTrialsConnector)
    registry.register("crossref", CrossrefConnector)
    registry.register("semantic_scholar", SemanticScholarConnector)
    registry.register("rss", RssConnector)
    return registry


# Module-level default registry instance
default_registry = create_default_registry()
