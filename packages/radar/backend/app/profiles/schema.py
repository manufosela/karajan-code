"""Pydantic schema for the Radar Profile.

A Radar Profile is the single source of truth for the domain a radar
instance watches. It replaces the constants that used to be hardcoded in
the codebase (VALID_THEMES, VALID_BUCKETS, VALID_TIME_HORIZONS,
VALID_IMPACT_LEVELS, VALID_HYPE_RISKS, VALID_RECOMMENDED_ACTIONS and the
per-connector DEFAULT_QUERY values).

Prompt templates use Mustache syntax (``{{variable}}``) rather than
``str.format``. This matters: the prompts embed JSON output schemas, and
with ``str.format`` every literal brace has to be doubled -- the previous
strategic prompt needed four consecutive braces to emit one. Mustache
leaves JSON examples untouched.
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.profiles.default_prompts import DEFAULT_PROMPTS
from app.profiles.mustache import outer_tags_in, tags_in

# ---------------------------------------------------------------------------
# Shared types
# ---------------------------------------------------------------------------

NonBlankStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

# Weights are floats, so exact equality against 1.0 is not a usable test.
_WEIGHT_SUM_TOLERANCE = 1e-6


class _FrozenModel(BaseModel):
    """Base for every profile component: immutable once loaded."""

    model_config = ConfigDict(frozen=True, extra="forbid")


def _find_duplicates(values: list[str]) -> list[str]:
    """Return the values appearing more than once, preserving first-seen order."""
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)
    return duplicates


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------


class TermDefinition(_FrozenModel):
    """A single entry of a controlled vocabulary.

    The description is not decorative: it is injected verbatim into the LLM
    prompt as the definition the model classifies against.
    """

    id: NonBlankStr
    label: NonBlankStr
    description: NonBlankStr


class ThemeDefinition(TermDefinition):
    """A thematic category a research item can be tagged with."""


class BucketDefinition(TermDefinition):
    """A strategic bucket a research item is assigned to."""


class TimeHorizonDefinition(TermDefinition):
    """A time horizon for when a finding could reach practice."""


class Taxonomy(_FrozenModel):
    """The classification vocabulary of a domain."""

    themes: list[ThemeDefinition] = Field(min_length=2)
    strategic_buckets: list[BucketDefinition] = Field(min_length=1)
    time_horizons: list[TimeHorizonDefinition] = Field(min_length=1)
    keywords: list[NonBlankStr] = Field(default_factory=list)

    @model_validator(mode="after")
    def _reject_duplicate_ids(self) -> Taxonomy:
        for entries, label in (
            (self.themes, "theme"),
            (self.strategic_buckets, "strategic bucket"),
            (self.time_horizons, "time horizon"),
        ):
            duplicates = _find_duplicates([entry.id for entry in entries])
            if duplicates:
                raise ValueError(f"duplicate {label} id: {', '.join(duplicates)}")
        return self

    @property
    def theme_ids(self) -> frozenset[str]:
        """Valid theme ids, for validating LLM responses."""
        return frozenset(entry.id for entry in self.themes)

    @property
    def bucket_ids(self) -> frozenset[str]:
        """Valid strategic bucket ids, for validating LLM responses."""
        return frozenset(entry.id for entry in self.strategic_buckets)

    @property
    def time_horizon_ids(self) -> frozenset[str]:
        """Valid time horizon ids, for validating LLM responses."""
        return frozenset(entry.id for entry in self.time_horizons)

    def theme(self, theme_id: str) -> ThemeDefinition:
        """Look up a theme by id.

        Raises:
            KeyError: If no theme carries that id.
        """
        for entry in self.themes:
            if entry.id == theme_id:
                return entry
        raise KeyError(f"unknown theme id: {theme_id}")

    def bucket(self, bucket_id: str) -> BucketDefinition:
        """Look up a strategic bucket by id.

        Raises:
            KeyError: If no bucket carries that id.
        """
        for entry in self.strategic_buckets:
            if entry.id == bucket_id:
                return entry
        raise KeyError(f"unknown strategic bucket id: {bucket_id}")


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------


class Vocabulary(_FrozenModel):
    """Closed value sets the LLM must choose from when scoring an item.

    Each entry carries its own description so the prompts can render the
    definitions by iterating over the profile, instead of restating what
    "transformative" or "high hype risk" mean in prose for every domain.

    ``impact_recommended_actions`` and ``scoring_recommended_actions`` are
    deliberately separate: the impact and scoring prompts have always used
    different action sets (archive/act_now versus discard/test), and merging
    them here would silently change classifier behaviour.
    """

    impact_levels: list[TermDefinition] = Field(min_length=1)
    hype_risks: list[TermDefinition] = Field(min_length=1)
    impact_recommended_actions: list[TermDefinition] = Field(min_length=1)
    scoring_recommended_actions: list[TermDefinition] = Field(min_length=1)

    @model_validator(mode="after")
    def _reject_duplicate_terms(self) -> Vocabulary:
        for entries, label in (
            (self.impact_levels, "impact_levels"),
            (self.hype_risks, "hype_risks"),
            (self.impact_recommended_actions, "impact_recommended_actions"),
            (self.scoring_recommended_actions, "scoring_recommended_actions"),
        ):
            duplicates = _find_duplicates([entry.id for entry in entries])
            if duplicates:
                raise ValueError(f"duplicate entry in {label}: {', '.join(duplicates)}")
        return self

    @property
    def impact_level_ids(self) -> frozenset[str]:
        """Valid impact level ids, for validating LLM responses."""
        return frozenset(entry.id for entry in self.impact_levels)

    @property
    def hype_risk_ids(self) -> frozenset[str]:
        """Valid hype risk ids, for validating LLM responses."""
        return frozenset(entry.id for entry in self.hype_risks)

    @property
    def impact_action_ids(self) -> frozenset[str]:
        """Valid recommended actions for the impact prompt."""
        return frozenset(entry.id for entry in self.impact_recommended_actions)

    @property
    def scoring_action_ids(self) -> frozenset[str]:
        """Valid recommended actions for the scoring prompt."""
        return frozenset(entry.id for entry in self.scoring_recommended_actions)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class ScoringWeights(_FrozenModel):
    """Relative weights combining the scoring dimensions into a final score."""

    weights: dict[str, Annotated[float, Field(ge=0.0, le=1.0)]] = Field(min_length=1)

    @model_validator(mode="after")
    def _weights_must_sum_to_one(self) -> ScoringWeights:
        total = math.fsum(self.weights.values())
        if not math.isclose(total, 1.0, abs_tol=_WEIGHT_SUM_TOLERANCE):
            raise ValueError(f"scoring weights must sum to 1.0, got {total:g}")
        return self


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


class PromptTemplate(_FrozenModel):
    """A Mustache prompt template plus the variables it expects."""

    template: NonBlankStr
    required_variables: list[NonBlankStr] = Field(default_factory=list)

    @model_validator(mode="after")
    def _declared_and_used_variables_must_match(self) -> PromptTemplate:
        used = self.variables_in_template
        declared = frozenset(self.required_variables)

        missing = sorted(declared - used)
        if missing:
            raise ValueError(f"variables declared but not used in template: {', '.join(missing)}")

        undeclared = sorted(used - declared)
        if undeclared:
            raise ValueError(
                f"variables used but not declared in required_variables: {', '.join(undeclared)}"
            )
        return self

    @property
    def variables_in_template(self) -> frozenset[str]:
        """Every Mustache tag name appearing in the template."""
        return tags_in(self.template)

    @property
    def outer_variables(self) -> frozenset[str]:
        """Tag names outside any section, which the caller must supply.

        Names used inside a section -- ``{{id}}`` within ``{{#themes}}`` --
        are resolved from each iterated item, not from the caller's context.
        """
        return outer_tags_in(self.template)


def _default_prompt(name: str) -> PromptTemplate:
    """Build one of the shared default templates."""
    return PromptTemplate.model_validate(DEFAULT_PROMPTS[name])


class PromptSet(_FrozenModel):
    """The five prompts driving the analysis pipeline.

    Each defaults to a domain-neutral template that renders its definitions
    from the profile's taxonomy and vocabulary, so a new domain only needs to
    override a prompt when the defaults genuinely do not fit.
    """

    classification: PromptTemplate = Field(default_factory=lambda: _default_prompt("classification"))
    strategic: PromptTemplate = Field(default_factory=lambda: _default_prompt("strategic"))
    impact: PromptTemplate = Field(default_factory=lambda: _default_prompt("impact"))
    scoring: PromptTemplate = Field(default_factory=lambda: _default_prompt("scoring"))
    summary: PromptTemplate = Field(default_factory=lambda: _default_prompt("summary"))


# ---------------------------------------------------------------------------
# Sources, LLM, organization, branding
# ---------------------------------------------------------------------------


class SourceConfig(_FrozenModel):
    """A data source the ingestion pipeline pulls from."""

    connector: NonBlankStr
    query: str | None = None
    enabled: bool = True
    priority: int = Field(default=1, ge=1)
    config: dict[str, Any] = Field(default_factory=dict)


class LLMSettings(_FrozenModel):
    """Which LLM backend analyses the ingested items."""

    provider: Literal["openai", "anthropic", "ollama"]
    default_model: NonBlankStr
    fast_model: NonBlankStr
    base_url: str | None = None


class Organization(_FrozenModel):
    """Who the radar reports for.

    These strings are interpolated into every analytical prompt, giving the
    model the vantage point it should reason from.
    """

    name: NonBlankStr
    description: NonBlankStr
    analyst_role: NonBlankStr


class Branding(_FrozenModel):
    """User-facing naming for this radar instance."""

    app_name: NonBlankStr
    short_name: NonBlankStr
    tagline: NonBlankStr


class FamilyContract(_FrozenModel):
    """Which karajan-family capabilities this instance speaks.

    The contract is opt-in per instance, and deliberately so: a radar
    watching car-pooling has no reason to pay for distilled cards, and a
    capability that costs tokens and latency should not arrive by default.
    Every flag is off unless a profile turns it on.

    Capabilities land here one card at a time; the ones not yet built are
    absent rather than declared and ignored, so a profile cannot ask for
    something the engine does not do.
    """

    distilled_cards: bool = False


class SummarySettings(_FrozenModel):
    """Languages the executive summary is generated in."""

    languages: list[NonBlankStr] = Field(min_length=1)

    @model_validator(mode="after")
    def _reject_duplicate_languages(self) -> SummarySettings:
        duplicates = _find_duplicates(self.languages)
        if duplicates:
            raise ValueError(f"duplicate entry in languages: {', '.join(duplicates)}")
        return self


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------


class RadarProfile(_FrozenModel):
    """A complete, validated domain definition for a radar instance."""

    id: NonBlankStr
    name: NonBlankStr
    version: NonBlankStr
    locale: NonBlankStr

    organization: Organization
    taxonomy: Taxonomy
    vocabulary: Vocabulary
    scoring: ScoringWeights
    sources: list[SourceConfig] = Field(min_length=1)
    prompts: PromptSet = Field(default_factory=PromptSet)
    llm: LLMSettings
    branding: Branding
    summary: SummarySettings
    family_contract: FamilyContract = Field(default_factory=FamilyContract)

    @model_validator(mode="after")
    def _reject_duplicate_connectors(self) -> RadarProfile:
        duplicates = _find_duplicates([source.connector for source in self.sources])
        if duplicates:
            raise ValueError(f"duplicate source connector: {', '.join(duplicates)}")
        return self

    @property
    def enabled_sources(self) -> list[SourceConfig]:
        """Sources the ingestion pipeline should actually query."""
        return [source for source in self.sources if source.enabled]
