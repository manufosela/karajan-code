"""Tests for the connector registry.

The case that matters here is a source the profile declares and the registry
cannot serve. Ingestion is periodic and unattended, so a source that is
silently dropped produces the same thing a quiet week produces -- fewer
items -- and nobody finds out until someone wonders why a feed went cold.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.connectors.base import BaseConnector
from app.connectors.registry import ConnectorRegistry, create_default_registry


class _FakeConnector(BaseConnector):
    """A connector that satisfies the interface and touches no network."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        super().__init__(source_name="fake", base_url="https://example.org", config=config or {})

    async def fetch(self) -> dict[str, Any]:
        return {}

    def parse(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        return []

    def normalize(self, parsed: list[dict[str, Any]]) -> list[Any]:
        return []


class _Source:
    def __init__(self, name: str, *, enabled: bool = True, config: dict | None = None) -> None:
        self.name = name
        self.enabled = enabled
        self.config = config or {}


# ---------------------------------------------------------------------------
# Registering
# ---------------------------------------------------------------------------


class TestRegistering:
    def test_registers_and_instantiates_by_name(self) -> None:
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        assert isinstance(registry.get("fake"), _FakeConnector)

    def test_the_name_is_case_insensitive(self) -> None:
        registry = ConnectorRegistry()
        registry.register("Fake", _FakeConnector)

        assert isinstance(registry.get("FAKE"), _FakeConnector)

    def test_rejects_a_class_that_is_not_a_connector(self) -> None:
        """Caught while starting, not halfway through an ingestion run."""
        registry = ConnectorRegistry()

        class NotAConnector:
            pass

        with pytest.raises(TypeError, match="BaseConnector subclass"):
            registry.register("bogus", NotAConnector)  # type: ignore[arg-type]

    def test_rejects_something_that_is_not_even_a_class(self) -> None:
        registry = ConnectorRegistry()

        with pytest.raises(TypeError, match="BaseConnector subclass"):
            registry.register("bogus", "app.connectors.rss:RssConnector")  # type: ignore[arg-type]

    def test_asking_for_an_unregistered_connector_names_what_there_is(self) -> None:
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        with pytest.raises(KeyError, match="fake"):
            registry.get("boe")


# ---------------------------------------------------------------------------
# Serving a profile's sources
# ---------------------------------------------------------------------------


class TestServingSources:
    def test_instantiates_the_enabled_sources(self) -> None:
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        connectors = registry.get_all_enabled([_Source("fake")])

        assert len(connectors) == 1

    def test_skips_a_disabled_source(self) -> None:
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        assert registry.get_all_enabled([_Source("fake", enabled=False)]) == []

    def test_passes_the_source_config_to_the_connector(self) -> None:
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        connectors = registry.get_all_enabled([_Source("fake", config={"feeds": ["a"]})])

        assert connectors[0].config == {"feeds": ["a"]}

    def test_a_source_with_no_connector_is_reported_not_swallowed(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """A declared source that never runs looks like a source that found nothing."""
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        connectors = registry.get_all_enabled([_Source("boe"), _Source("fake")])

        assert len(connectors) == 1
        reported = capsys.readouterr().out
        assert "source_has_no_connector" in reported
        assert "boe" in reported

    def test_one_unusable_source_does_not_cost_the_others(self) -> None:
        """One bad source should not take an unattended run down with it."""
        registry = ConnectorRegistry()
        registry.register("fake", _FakeConnector)

        connectors = registry.get_all_enabled([_Source("nope"), _Source("fake"), _Source("also-no")])

        assert len(connectors) == 1


# ---------------------------------------------------------------------------
# The bundled connectors
# ---------------------------------------------------------------------------


class TestTheDefaultRegistry:
    def test_registers_the_connectors_the_engine_ships(self) -> None:
        names = set(create_default_registry().registered_names)

        assert names == {
            "pubmed",
            "arxiv",
            "clinical_trials",
            "crossref",
            "semantic_scholar",
            "rss",
        }
