"""A small Mustache engine for Radar Profile prompt templates.

Implements the subset the profiles actually use -- interpolation, sections
and inverted sections -- rather than pulling in a dependency for it. Two
deliberate departures from the specification:

* Values are never HTML-escaped. Prompts are plain text for an LLM, and
  escaping would turn ``&`` into ``&amp;`` inside a search query.
* An unknown tag raises instead of rendering an empty string. A prompt that
  quietly loses its abstract still looks like a valid prompt, and the failure
  would only surface as degraded classifications much later.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

# A section: {{#name}}body{{/name}} or {{^name}}body{{/name}}. Non-greedy so
# the nearest matching close wins; the backreference keeps sibling sections
# from swallowing each other.
SECTION = re.compile(
    r"\{\{\s*([#^])\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}(.*?)\{\{\s*/\s*\2\s*\}\}",
    re.DOTALL,
)

# An interpolation: {{name}}, or {{.}} for the current scalar item.
VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*|\.)\s*\}\}")

# Any tag at all, including section sigils -- used for static analysis.
ANY_TAG = re.compile(r"\{\{\s*[#^/&!]?\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}")

# An opening section tag, used to detect sections that were never closed.
SECTION_OPEN = re.compile(r"\{\{\s*[#^]\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


class RenderError(Exception):
    """Raised when a template cannot be rendered."""


class MissingVariableError(RenderError):
    """Raised when a template references a name absent from the context."""


def tags_in(template: str) -> frozenset[str]:
    """Every tag name appearing anywhere in the template."""
    return frozenset(ANY_TAG.findall(template))


def outer_tags_in(template: str) -> frozenset[str]:
    """Tag names outside any section block.

    These are the names the caller must supply. Names used *inside* a section
    (``{{id}}`` within ``{{#themes}}``) are resolved from each iterated item,
    so requiring them from the caller would be wrong.
    """
    stripped = template
    while True:
        collapsed = SECTION.sub("", stripped)
        if collapsed == stripped:
            break
        stripped = collapsed

    return frozenset(ANY_TAG.findall(stripped))


def render(template: str, context: Mapping[str, Any]) -> str:
    """Render a Mustache template against a context.

    Args:
        template: The template source.
        context: Values available to the template.

    Returns:
        The rendered text.

    Raises:
        MissingVariableError: If the template references an unknown name.
        RenderError: If the template is malformed.
    """
    expanded = _render_sections(template, context)
    return _render_variables(expanded, context)


def _render_sections(template: str, context: Mapping[str, Any]) -> str:
    """Expand every section, its body rendered once per item."""

    def expand(match: re.Match[str]) -> str:
        sigil, name, body = match.group(1), match.group(2), match.group(3)

        if name not in context:
            raise MissingVariableError(f"template references unknown section '{name}'")

        value = context[name]

        if sigil == "^":
            return _render_sections(body, context) if not value else ""

        if not value:
            return ""

        # A section body starting on its own line should not emit a leading
        # blank line on every iteration.
        if body.startswith("\n"):
            body = body[1:]

        items = value if isinstance(value, list) else [value]
        return "".join(_render_item(body, item, context) for item in items)

    rendered = SECTION.sub(expand, template)

    leftover = SECTION_OPEN.search(rendered)
    if leftover:
        raise RenderError(f"unclosed section '{leftover.group(1)}' in template")

    return rendered


def _render_item(body: str, item: Any, outer: Mapping[str, Any]) -> str:
    """Render a section body for one item, the item shadowing the outer scope."""
    if isinstance(item, Mapping):
        scope: dict[str, Any] = {**outer, **item}
    else:
        scope = {**outer, ".": item}

    return render(body, scope)


def _render_variables(template: str, context: Mapping[str, Any]) -> str:
    """Substitute interpolation tags. Substituted values are left inert."""

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in context:
            raise MissingVariableError(f"template references unknown variable '{name}'")
        return str(context[name])

    return VARIABLE.sub(substitute, template)
