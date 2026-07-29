"""The bundled orthodontics profile must preserve the original domain exactly.

These values were hardcoded across the codebase before the Radar Profile
existed (VALID_THEMES, VALID_BUCKETS, VALID_TIME_HORIZONS, VALID_IMPACT_LEVELS,
VALID_HYPE_RISKS and two distinct VALID_RECOMMENDED_ACTIONS sets). The
constants are gone; these literals are what they contained.

Asserting them explicitly keeps a careless edit to the YAML from silently
changing how every item is classified.
"""

from __future__ import annotations

import pytest

from app.profiles.loader import load_profile_by_id
from app.profiles.schema import RadarProfile


@pytest.fixture(scope="module")
def orthodontics() -> RadarProfile:
    return load_profile_by_id("orthodontics")


class TestTaxonomy:
    def test_themes(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.taxonomy.theme_ids == frozenset(
            {
                "orthodontics",
                "biomechanics",
                "materials",
                "AI/digital",
                "clinical",
                "other",
            }
        )

    def test_strategic_buckets(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.taxonomy.bucket_ids == frozenset(
            {
                "core_aligner_tech",
                "emerging_materials",
                "ai_digital_workflow",
                "biomechanics_research",
                "clinical_evidence",
                "regulatory_compliance",
                "competitive_intelligence",
            }
        )

    def test_time_horizons(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.taxonomy.time_horizon_ids == frozenset(
            {"immediate", "short_term", "medium_term", "long_term"}
        )

    def test_every_theme_carries_a_definition_for_the_prompt(
        self, orthodontics: RadarProfile
    ) -> None:
        for theme in orthodontics.taxonomy.themes:
            assert theme.description.strip()


class TestVocabulary:
    def test_impact_levels(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.vocabulary.impact_level_ids == frozenset(
            {"transformative", "significant", "moderate", "incremental", "minimal"}
        )

    def test_hype_risks(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.vocabulary.hype_risk_ids == frozenset(
            {"low", "medium", "high"}
        )

    def test_impact_actions(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.vocabulary.impact_action_ids == frozenset(
            {"monitor", "investigate", "act_now", "archive"}
        )

    def test_scoring_actions(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.vocabulary.scoring_action_ids == frozenset(
            {"monitor", "investigate", "test", "discard"}
        )

    def test_the_two_action_sets_genuinely_differ(
        self, orthodontics: RadarProfile
    ) -> None:
        """Preserved from the original code, where impact.py and scoring.py
        declared different actions. Unifying them would change behaviour."""
        impact = orthodontics.vocabulary.impact_action_ids
        scoring = orthodontics.vocabulary.scoring_action_ids

        assert frozenset({"act_now", "archive"}) == impact - scoring
        assert frozenset({"test", "discard"}) == scoring - impact


class TestSummary:
    def test_generates_english_and_spanish(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.summary.languages == ["en", "es"]


class TestSources:
    def test_declares_every_originally_seeded_connector(
        self, orthodontics: RadarProfile
    ) -> None:
        assert {source.connector for source in orthodontics.sources} == {
            "pubmed",
            "arxiv",
            "clinical_trials",
            "crossref",
            "semantic_scholar",
        }

    def test_every_source_carries_a_query(self, orthodontics: RadarProfile) -> None:
        for source in orthodontics.sources:
            assert source.query, f"{source.connector} has no query"

    def test_pubmed_query_terms(self, orthodontics: RadarProfile) -> None:
        """Taken from the connector's DEFAULT_QUERY, not the database seed:
        the seeded query duplicated the date filter the connector adds."""
        pubmed = next(s for s in orthodontics.sources if s.connector == "pubmed")

        assert pubmed.query is not None
        for term in ("orthodontics", "clear aligners", "tooth movement", "aligner"):
            assert term in pubmed.query


class TestScoring:
    def test_weights_are_evenly_split(self, orthodontics: RadarProfile) -> None:
        assert orthodontics.scoring.weights == {
            "scientific_strength": 0.5,
            "strategic_relevance": 0.5,
        }
