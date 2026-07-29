"""Tests for the Radar Profile Pydantic schema.

The Radar Profile is the single source of truth for everything that is
domain-specific: taxonomy, vocabularies, prompts, sources and branding.
Nothing about a given subject matter may remain hardcoded in the codebase.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest
from pydantic import ValidationError

from app.profiles.schema import (
    Branding,
    LLMSettings,
    Organization,
    PromptTemplate,
    RadarProfile,
    ScoringWeights,
    Taxonomy,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _minimal_profile_dict() -> dict[str, Any]:
    """A valid, fully-populated profile used as the base for mutation tests."""
    return {
        "id": "test-domain",
        "name": "Test Domain Radar",
        "version": "1.0.0",
        "locale": "en",
        "organization": {
            "name": "Acme Corp",
            "description": "a company specializing in widgets",
            "analyst_role": "expert widget research analyst",
        },
        "taxonomy": {
            "themes": [
                {"id": "alpha", "label": "Alpha", "description": "Alpha topics."},
                {"id": "beta", "label": "Beta", "description": "Beta topics."},
            ],
            "strategic_buckets": [
                {"id": "core_tech", "label": "Core Tech", "description": "Core technology."},
            ],
            "time_horizons": [
                {"id": "immediate", "label": "Immediate", "description": "0-6 months."},
                {"id": "long_term", "label": "Long term", "description": "Beyond 36 months."},
            ],
            "keywords": ["widget", "gadget"],
        },
        "vocabulary": {
            "impact_levels": [
                {"id": "transformative", "label": "Transformative", "description": "Paradigm shift."},
                {"id": "minimal", "label": "Minimal", "description": "Little relevance."},
            ],
            "hype_risks": [
                {"id": "low", "label": "Low", "description": "Conservative claims."},
                {"id": "medium", "label": "Medium", "description": "Some concerns."},
                {"id": "high", "label": "High", "description": "Weak evidence."},
            ],
            "impact_recommended_actions": [
                {"id": "monitor", "label": "Monitor", "description": "Track over time."},
                {"id": "archive", "label": "Archive", "description": "File for reference."},
            ],
            "scoring_recommended_actions": [
                {"id": "monitor", "label": "Monitor", "description": "Track over time."},
                {"id": "discard", "label": "Discard", "description": "Not relevant."},
            ],
        },
        "scoring": {
            "weights": {"scientific_strength": 0.6, "strategic_relevance": 0.4},
        },
        "sources": [
            {"connector": "pubmed", "query": "widgets", "enabled": True, "priority": 1},
        ],
        "prompts": {
            "classification": {
                "template": "Classify {{title}} with {{abstract}}.",
                "required_variables": ["title", "abstract"],
            },
            "strategic": {
                "template": "Bucket {{title}} / {{abstract}}.",
                "required_variables": ["title", "abstract"],
            },
            "impact": {
                "template": "Impact of {{title}} / {{abstract}}.",
                "required_variables": ["title", "abstract"],
            },
            "scoring": {
                "template": "Score {{title}} / {{abstract}}.",
                "required_variables": ["title", "abstract"],
            },
            "summary": {
                "template": "Summarize {{title}} / {{abstract}}.",
                "required_variables": ["title", "abstract"],
            },
        },
        "llm": {
            "provider": "openai",
            "default_model": "gpt-4o",
            "fast_model": "gpt-4o-mini",
        },
        "branding": {
            "app_name": "Test Domain Radar",
            "short_name": "TDR",
            "tagline": "Widget intelligence",
        },
        "summary": {"languages": ["en", "es"]},
    }


@pytest.fixture
def profile_dict() -> dict[str, Any]:
    return _minimal_profile_dict()


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

class TestValidProfile:
    def test_parses_a_valid_profile(self, profile_dict: dict[str, Any]) -> None:
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.id == "test-domain"
        assert profile.organization.name == "Acme Corp"
        assert len(profile.taxonomy.themes) == 2
        assert profile.llm.provider == "openai"

    def test_exposes_theme_ids_as_a_frozenset(self, profile_dict: dict[str, Any]) -> None:
        """Services validate LLM output against these sets, replacing VALID_THEMES."""
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.taxonomy.theme_ids == frozenset({"alpha", "beta"})

    def test_exposes_bucket_and_horizon_ids_as_frozensets(
        self, profile_dict: dict[str, Any]
    ) -> None:
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.taxonomy.bucket_ids == frozenset({"core_tech"})
        assert profile.taxonomy.time_horizon_ids == frozenset({"immediate", "long_term"})

    def test_is_immutable(self, profile_dict: dict[str, Any]) -> None:
        """A loaded profile must not be mutated at runtime by accident."""
        profile = RadarProfile.model_validate(profile_dict)

        with pytest.raises(ValidationError):
            profile.id = "something-else"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Taxonomy validation
# ---------------------------------------------------------------------------

class TestTaxonomyValidation:
    def test_rejects_duplicate_theme_ids(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["taxonomy"]["themes"].append(
            {"id": "alpha", "label": "Alpha again", "description": "Duplicate."}
        )

        with pytest.raises(ValidationError, match="duplicate theme id"):
            RadarProfile.model_validate(profile_dict)

    def test_rejects_duplicate_bucket_ids(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["taxonomy"]["strategic_buckets"].append(
            {"id": "core_tech", "label": "Dup", "description": "Duplicate."}
        )

        with pytest.raises(ValidationError, match="duplicate strategic bucket id"):
            RadarProfile.model_validate(profile_dict)

    def test_rejects_duplicate_time_horizon_ids(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["taxonomy"]["time_horizons"].append(
            {"id": "immediate", "label": "Dup", "description": "Duplicate."}
        )

        with pytest.raises(ValidationError, match="duplicate time horizon id"):
            RadarProfile.model_validate(profile_dict)

    def test_requires_at_least_two_themes(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["taxonomy"]["themes"] = [
            {"id": "alpha", "label": "Alpha", "description": "Only one."}
        ]

        with pytest.raises(ValidationError):
            RadarProfile.model_validate(profile_dict)

    def test_requires_at_least_one_strategic_bucket(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["taxonomy"]["strategic_buckets"] = []

        with pytest.raises(ValidationError):
            RadarProfile.model_validate(profile_dict)

    def test_rejects_blank_theme_description(self, profile_dict: dict[str, Any]) -> None:
        """Descriptions are injected into prompts; a blank one silently degrades output."""
        profile_dict["taxonomy"]["themes"][0]["description"] = "   "

        with pytest.raises(ValidationError):
            RadarProfile.model_validate(profile_dict)


# ---------------------------------------------------------------------------
# Scoring weights validation
# ---------------------------------------------------------------------------

class TestScoringWeights:
    def test_accepts_weights_summing_to_one(self) -> None:
        weights = ScoringWeights.model_validate(
            {"weights": {"a": 0.25, "b": 0.25, "c": 0.5}}
        )

        assert weights.weights["c"] == 0.5

    def test_rejects_weights_not_summing_to_one(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["scoring"]["weights"] = {"scientific_strength": 0.6, "strategic_relevance": 0.6}

        with pytest.raises(ValidationError, match="must sum to 1.0"):
            RadarProfile.model_validate(profile_dict)

    def test_tolerates_floating_point_imprecision(self) -> None:
        """0.1 + 0.2 + 0.7 does not sum to exactly 1.0 in binary floating point."""
        weights = ScoringWeights.model_validate({"weights": {"a": 0.1, "b": 0.2, "c": 0.7}})

        assert len(weights.weights) == 3

    def test_rejects_negative_weights(self) -> None:
        with pytest.raises(ValidationError):
            ScoringWeights.model_validate({"weights": {"a": -0.5, "b": 1.5}})

    def test_rejects_empty_weights(self) -> None:
        with pytest.raises(ValidationError):
            ScoringWeights.model_validate({"weights": {}})


# ---------------------------------------------------------------------------
# Prompt template validation
# ---------------------------------------------------------------------------

class TestPromptTemplateValidation:
    def test_accepts_template_declaring_all_its_variables(self) -> None:
        template = PromptTemplate.model_validate(
            {
                "template": "Analyse {{title}} and {{abstract}}.",
                "required_variables": ["title", "abstract"],
            }
        )

        assert template.variables_in_template == frozenset({"title", "abstract"})

    def test_rejects_declared_variable_missing_from_template(self) -> None:
        """Declaring a variable the template never uses means the caller's data is dropped."""
        with pytest.raises(ValidationError, match="declared but not used"):
            PromptTemplate.model_validate(
                {
                    "template": "Analyse {{title}}.",
                    "required_variables": ["title", "abstract"],
                }
            )

    def test_rejects_undeclared_variable_used_in_template(self) -> None:
        """An undeclared placeholder would render as an empty string at runtime."""
        with pytest.raises(ValidationError, match="used but not declared"):
            PromptTemplate.model_validate(
                {
                    "template": "Analyse {{title}} for {{company_name}}.",
                    "required_variables": ["title"],
                }
            )

    def test_ignores_mustache_section_blocks(self) -> None:
        """{{#each}} / {{/each}} are control structures, not data variables."""
        template = PromptTemplate.model_validate(
            {
                "template": "{{#themes}}- {{label}}\n{{/themes}}Title: {{title}}",
                "required_variables": ["themes", "label", "title"],
            }
        )

        assert "themes" in template.variables_in_template

    def test_rejects_empty_template(self) -> None:
        with pytest.raises(ValidationError):
            PromptTemplate.model_validate({"template": "   ", "required_variables": []})

    def test_json_braces_need_no_escaping(self) -> None:
        """Mustache lets output-schema examples appear literally, unlike str.format."""
        template = PromptTemplate.model_validate(
            {
                "template": 'Return {"bucket": "<id>"} for {{title}}.',
                "required_variables": ["title"],
            }
        )

        assert '{"bucket"' in template.template


# ---------------------------------------------------------------------------
# Vocabulary and sources
# ---------------------------------------------------------------------------

class TestVocabularyValidation:
    def test_rejects_duplicate_vocabulary_entries(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["vocabulary"]["hype_risks"].append(
            {"id": "low", "label": "Low again", "description": "Duplicate."}
        )

        with pytest.raises(ValidationError, match="duplicate"):
            RadarProfile.model_validate(profile_dict)

    def test_rejects_empty_vocabulary_list(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["vocabulary"]["impact_levels"] = []

        with pytest.raises(ValidationError):
            RadarProfile.model_validate(profile_dict)

    def test_impact_and_scoring_actions_may_differ(self, profile_dict: dict[str, Any]) -> None:
        """The current codebase uses two different action vocabularies; preserve that."""
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.vocabulary.impact_action_ids == frozenset({"monitor", "archive"})
        assert profile.vocabulary.scoring_action_ids == frozenset({"monitor", "discard"})

    def test_exposes_vocabulary_ids_as_frozensets(self, profile_dict: dict[str, Any]) -> None:
        """These sets replace VALID_IMPACT_LEVELS and VALID_HYPE_RISKS."""
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.vocabulary.impact_level_ids == frozenset({"transformative", "minimal"})
        assert profile.vocabulary.hype_risk_ids == frozenset({"low", "medium", "high"})

    def test_vocabulary_entries_carry_descriptions_for_prompt_rendering(
        self, profile_dict: dict[str, Any]
    ) -> None:
        profile = RadarProfile.model_validate(profile_dict)

        assert profile.vocabulary.impact_levels[0].description == "Paradigm shift."


class TestSourcesValidation:
    def test_rejects_duplicate_connectors(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["sources"].append({"connector": "pubmed", "query": "other"})

        with pytest.raises(ValidationError, match="duplicate"):
            RadarProfile.model_validate(profile_dict)

    def test_requires_at_least_one_source(self, profile_dict: dict[str, Any]) -> None:
        profile_dict["sources"] = []

        with pytest.raises(ValidationError):
            RadarProfile.model_validate(profile_dict)

    def test_defaults_enabled_to_true(self) -> None:
        from app.profiles.schema import SourceConfig

        source = SourceConfig.model_validate({"connector": "arxiv"})

        assert source.enabled is True


# ---------------------------------------------------------------------------
# Component-level construction
# ---------------------------------------------------------------------------

class TestComponentModels:
    def test_organization_rejects_blank_name(self) -> None:
        with pytest.raises(ValidationError):
            Organization.model_validate(
                {"name": "  ", "description": "d", "analyst_role": "r"}
            )

    def test_branding_rejects_blank_app_name(self) -> None:
        with pytest.raises(ValidationError):
            Branding.model_validate({"app_name": "", "short_name": "X", "tagline": "t"})

    def test_llm_settings_reject_unknown_provider(self) -> None:
        with pytest.raises(ValidationError):
            LLMSettings.model_validate(
                {"provider": "skynet", "default_model": "m", "fast_model": "f"}
            )

    def test_llm_settings_accept_ollama_with_base_url(self) -> None:
        settings = LLMSettings.model_validate(
            {
                "provider": "ollama",
                "default_model": "llama3.1",
                "fast_model": "llama3.1",
                "base_url": "http://localhost:11434",
            }
        )

        assert settings.base_url == "http://localhost:11434"

    def test_taxonomy_lookup_by_id(self) -> None:
        taxonomy = Taxonomy.model_validate(
            _minimal_profile_dict()["taxonomy"]
        )

        assert taxonomy.theme("alpha").label == "Alpha"

    def test_taxonomy_lookup_raises_for_unknown_id(self) -> None:
        taxonomy = Taxonomy.model_validate(_minimal_profile_dict()["taxonomy"])

        with pytest.raises(KeyError):
            taxonomy.theme("nonexistent")


# ---------------------------------------------------------------------------
# Regression guard: mutation of the source dict must not leak into the model
# ---------------------------------------------------------------------------

class TestIsolation:
    def test_model_does_not_alias_the_input_dict(self, profile_dict: dict[str, Any]) -> None:
        original = copy.deepcopy(profile_dict)
        profile = RadarProfile.model_validate(profile_dict)

        profile_dict["taxonomy"]["themes"].clear()

        assert len(profile.taxonomy.themes) == len(original["taxonomy"]["themes"])
