"""Loading connectors that live outside this repository.

A connector that knows a protocol belongs in the engine; a connector that
knows one organisation belongs to the instance that cares about it. Without
somewhere to put the second kind, every instance-specific source would have
to be contributed to the core and carried by every other instance forever.

An instance declares its own with ``RADAR_CONNECTORS``:

    RADAR_CONNECTORS="boe=myinstance.connectors.boe:BoeConnector"

Several are separated by commas. The class has to be importable by the
process -- installed, or on PYTHONPATH.

Everything here fails loudly and while the process is starting. A connector
that cannot be loaded is a source that will not be queried, and the whole
point of this card is that such a source must never disappear quietly.

Trust: naming a class here is asking the process to import and run it, so
the value belongs to whoever deploys the instance. It is the same trust
already placed in the profile and in the image's dependencies, but it should
be stated rather than assumed -- never build this value from anything that
arrives from outside the deployment.
"""

from __future__ import annotations

import os
from importlib import import_module

from app.connectors.base import BaseConnector
from app.core.logging import get_logger

logger = get_logger(__name__)

_ENV_VAR = "RADAR_CONNECTORS"


class ConnectorSpecError(ValueError):
    """Raised when a connector declaration cannot be turned into a class."""


def load_declared_connectors(declaration: str | None = None) -> dict[str, type[BaseConnector]]:
    """Load the connectors an instance declares outside the engine.

    Args:
        declaration: The raw declaration. Defaults to RADAR_CONNECTORS.

    Returns:
        Connector classes by the name they are registered under. Empty when
        nothing is declared, which is the normal case.

    Raises:
        ConnectorSpecError: If a declaration is malformed, its module or
            class cannot be imported, or the class is not a connector.
    """
    raw = declaration if declaration is not None else os.getenv(_ENV_VAR, "")
    specs = [part.strip() for part in raw.split(",") if part.strip()]

    if not specs:
        return {}

    connectors = {name: _load(target, spec) for name, target, spec in map(_split, specs)}

    logger.info("loaded_external_connectors", names=sorted(connectors))
    return connectors


def _split(spec: str) -> tuple[str, str, str]:
    """Break ``name=module:Class`` into its parts.

    Raises:
        ConnectorSpecError: If either separator is missing.
    """
    name, separator, target = spec.partition("=")
    if not separator or not name.strip() or not target.strip():
        raise ConnectorSpecError(
            f"{_ENV_VAR} entry {spec!r} is not 'name=module:Class'; the name says what a "
            "profile calls the source and the rest says where the class lives"
        )

    if ":" not in target:
        raise ConnectorSpecError(
            f"{_ENV_VAR} entry {spec!r} needs a ':' between the module and the class, "
            "as in 'boe=myinstance.connectors.boe:BoeConnector'"
        )

    return name.strip().lower(), target.strip(), spec


def _load(target: str, spec: str) -> type[BaseConnector]:
    """Import one declared class.

    Args:
        target: The ``module:Class`` half of the declaration.
        spec: The whole entry, quoted back in any error so a deployment with
            several declared connectors knows which one is wrong.

    Raises:
        ConnectorSpecError: If it cannot be imported or is not a connector.
    """
    module_name, _, class_name = target.partition(":")

    try:
        module = import_module(module_name)
    except ImportError as exc:
        raise ConnectorSpecError(
            f"{_ENV_VAR} entry {spec!r}: cannot import '{module_name}' ({exc}). "
            "The class has to be installed in this environment or on PYTHONPATH."
        ) from exc

    try:
        candidate = getattr(module, class_name)
    except AttributeError as exc:
        raise ConnectorSpecError(f"{_ENV_VAR} entry {spec!r}: '{module_name}' has no '{class_name}'") from exc

    if not isinstance(candidate, type) or not issubclass(candidate, BaseConnector):
        raise ConnectorSpecError(f"{_ENV_VAR} entry {spec!r}: '{class_name}' is not a BaseConnector subclass")

    return candidate
