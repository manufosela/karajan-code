"""Tests for loading connectors declared outside the engine.

Every failure here has the same consequence -- a source the profile
declares will not be queried -- so every one of them raises while the
process is starting rather than turning into a quiet gap in the results.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.connectors.base import BaseConnector
from app.connectors.external import ConnectorSpecError, load_declared_connectors


class _InstanceConnector(BaseConnector):
    """Stands in for the connector an instance would write for itself."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        super().__init__(source_name="boe", base_url="https://example.org", config=config or {})

    async def fetch(self) -> dict[str, Any]:
        return {}

    def parse(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        return []

    def normalize(self, parsed: list[dict[str, Any]]) -> list[Any]:
        return []


_HERE = "tests.unit.test_connectors.test_external"


# ---------------------------------------------------------------------------
# Nothing declared
# ---------------------------------------------------------------------------


class TestNothingDeclared:
    def test_no_declaration_loads_nothing(self) -> None:
        """The normal case: an instance that uses only bundled connectors."""
        assert load_declared_connectors("") == {}

    def test_whitespace_and_stray_commas_are_not_a_declaration(self) -> None:
        assert load_declared_connectors("  , ,  ") == {}

    def test_falls_back_to_the_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RADAR_CONNECTORS", f"boe={_HERE}:_InstanceConnector")

        assert "boe" in load_declared_connectors()


# ---------------------------------------------------------------------------
# A connector is declared
# ---------------------------------------------------------------------------


class TestLoading:
    def test_loads_the_class_under_the_declared_name(self) -> None:
        loaded = load_declared_connectors(f"boe={_HERE}:_InstanceConnector")

        assert loaded == {"boe": _InstanceConnector}

    def test_loads_several(self) -> None:
        loaded = load_declared_connectors(
            f"boe={_HERE}:_InstanceConnector, congreso={_HERE}:_InstanceConnector"
        )

        assert sorted(loaded) == ["boe", "congreso"]

    def test_the_name_is_lowercased_to_match_a_profile_source(self) -> None:
        loaded = load_declared_connectors(f"BOE={_HERE}:_InstanceConnector")

        assert "boe" in loaded


# ---------------------------------------------------------------------------
# The declaration is wrong
# ---------------------------------------------------------------------------


class TestBadDeclarations:
    @pytest.mark.parametrize(
        "spec",
        ["boe", f"{_HERE}:_InstanceConnector", "=mod:Class", "boe="],
        ids=["no-target", "no-name", "empty-name", "empty-target"],
    )
    def test_rejects_a_malformed_entry(self, spec: str) -> None:
        with pytest.raises(ConnectorSpecError, match="name=module:Class"):
            load_declared_connectors(spec)

    def test_rejects_a_target_without_a_class(self) -> None:
        with pytest.raises(ConnectorSpecError, match="needs a ':'"):
            load_declared_connectors("boe=myinstance.connectors.boe")

    def test_says_so_when_the_module_is_not_installed(self) -> None:
        """The likeliest mistake in a deployment, and the least obvious."""
        with pytest.raises(ConnectorSpecError, match="cannot import"):
            load_declared_connectors("boe=nowhere.at.all:BoeConnector")

    def test_says_so_when_the_class_is_not_in_the_module(self) -> None:
        with pytest.raises(ConnectorSpecError, match="has no 'Missing'"):
            load_declared_connectors(f"boe={_HERE}:Missing")

    def test_rejects_a_class_that_is_not_a_connector(self) -> None:
        with pytest.raises(ConnectorSpecError, match="not a BaseConnector"):
            load_declared_connectors(f"boe={_HERE}:_HERE")

    def test_the_error_quotes_the_entry_that_is_wrong(self) -> None:
        """With several declared, the message has to say which one."""
        good = f"boe={_HERE}:_InstanceConnector"

        with pytest.raises(ConnectorSpecError, match="congreso=nowhere:X"):
            load_declared_connectors(f"{good},congreso=nowhere:X")
