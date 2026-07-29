"""Prompt rendering driven by a Radar Profile.

The renderer flattens a profile into the names its templates address, so the
prompts carry no domain knowledge of their own: the list of themes, the
definition of each impact level and the "MUST be one of" rules are all
rendered from profile data.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from app.profiles.mustache import (
    MissingVariableError,
    RenderError,
    render,
)
from app.profiles.schema import RadarProfile, TermDefinition

__all__ = [
    "MissingVariableError",
    "PromptRenderer",
    "RenderError",
    "render_template",
]


def render_template(template: str, context: Mapping[str, Any]) -> str:
    """Render a Mustache template against a context.

    Raises:
        MissingVariableError: If the template references an unknown name.
        RenderError: If the template is malformed.
    """
    return render(template, context)


class PromptRenderer:
    """Renders a profile's prompts, supplying the domain context automatically.

    The base context is derived once from the profile; per-item values such as
    a paper's title and abstract are layered on top at render time.
    """

    def __init__(self, profile: RadarProfile) -> None:
        self._profile = profile
        self._base_context = self._build_base_context(profile)

    @property
    def profile(self) -> RadarProfile:
        """The profile this renderer draws its domain context from."""
        return self._profile

    def base_context(self) -> dict[str, Any]:
        """A copy of the profile-derived context shared by every prompt."""
        return dict(self._base_context)

    def render(self, prompt_name: str, **variables: Any) -> str:
        """Render one of the profile's named prompts.

        Args:
            prompt_name: One of classification, strategic, impact, scoring, summary.
            **variables: Per-item values such as title and abstract.

        Returns:
            The rendered prompt.

        Raises:
            KeyError: If the profile defines no prompt under that name.
            MissingVariableError: If a variable the template needs is absent.
        """
        prompts = self._profile.prompts
        if prompt_name not in type(prompts).model_fields:
            available = ", ".join(type(prompts).model_fields)
            raise KeyError(f"unknown prompt '{prompt_name}'; profile defines: {available}")

        prompt = getattr(prompts, prompt_name)
        context = {**self._base_context, **variables}

        # Only names used outside a section have to come from the caller;
        # names inside a section are resolved per iterated item.
        missing = sorted(prompt.outer_variables - context.keys())
        if missing:
            raise MissingVariableError(
                f"prompt '{prompt_name}' requires variables not supplied: {', '.join(missing)}"
            )

        return render(prompt.template, context)

    @staticmethod
    def _build_base_context(profile: RadarProfile) -> dict[str, Any]:
        """Flatten the profile into the names the templates address."""
        taxonomy = profile.taxonomy
        vocabulary = profile.vocabulary

        return {
            "organization_name": profile.organization.name,
            "organization_description": profile.organization.description,
            "analyst_role": profile.organization.analyst_role,
            "app_name": profile.branding.app_name,
            "locale": profile.locale,
            "themes": _as_mappings(taxonomy.themes),
            "strategic_buckets": _as_mappings(taxonomy.strategic_buckets),
            "time_horizons": _as_mappings(taxonomy.time_horizons),
            "impact_levels": _as_mappings(vocabulary.impact_levels),
            "hype_risks": _as_mappings(vocabulary.hype_risks),
            "impact_recommended_actions": _as_mappings(vocabulary.impact_recommended_actions),
            "scoring_recommended_actions": _as_mappings(vocabulary.scoring_recommended_actions),
            "keywords": list(taxonomy.keywords),
            "theme_ids_csv": _ids_csv(taxonomy.themes),
            "bucket_ids_csv": _ids_csv(taxonomy.strategic_buckets),
            "time_horizon_ids_csv": _ids_csv(taxonomy.time_horizons),
            "impact_level_ids_csv": _ids_csv(vocabulary.impact_levels),
            "hype_risk_ids_csv": _ids_csv(vocabulary.hype_risks),
            "impact_action_ids_csv": _ids_csv(vocabulary.impact_recommended_actions),
            "scoring_action_ids_csv": _ids_csv(vocabulary.scoring_recommended_actions),
            "keywords_csv": ", ".join(taxonomy.keywords),
            "summary_language_codes_csv": ", ".join(profile.summary.languages),
        }


def _as_mappings(entries: Iterable[TermDefinition]) -> list[dict[str, str]]:
    """Expose term definitions as plain mappings for section iteration."""
    return [{"id": entry.id, "label": entry.label, "description": entry.description} for entry in entries]


def _ids_csv(entries: Iterable[TermDefinition]) -> str:
    """Join term ids in declaration order, for the "MUST be one of" rules."""
    return ", ".join(entry.id for entry in entries)
