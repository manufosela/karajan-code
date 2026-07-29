"""The bundled orthodontics profile must reproduce the legacy constants exactly.

While the hardcoded domain constants still exist alongside the Radar Profile,
these tests guard the migration: if the YAML and the constants drift apart,
the profile is no longer a faithful replacement and switching the services
over to it (FRD-TSK-0019) would silently change classifier behaviour.

Delete this module once the constants are gone.
"""

from __future__ import annotations

import pytest

from app.profiles.loader import load_profile_by_id
from app.profiles.schema import RadarProfile


@pytest.fixture(scope="module")
def orthodontics() -> RadarProfile:
    return load_profile_by_id("orthodontics")


class TestTaxonomyParity:
    def test_themes_match_valid_themes(self, orthodontics: RadarProfile) -> None:
        from app.llm.prompts.classification import VALID_THEMES

        assert orthodontics.taxonomy.theme_ids == VALID_THEMES

    def test_buckets_match_valid_buckets(self, orthodontics: RadarProfile) -> None:
        from app.llm.prompts.strategic import VALID_BUCKETS

        assert orthodontics.taxonomy.bucket_ids == VALID_BUCKETS

    def test_time_horizons_match_valid_time_horizons(
        self, orthodontics: RadarProfile
    ) -> None:
        from app.llm.prompts.strategic import VALID_TIME_HORIZONS

        assert orthodontics.taxonomy.time_horizon_ids == VALID_TIME_HORIZONS


class TestVocabularyParity:
    def test_impact_levels_match(self, orthodontics: RadarProfile) -> None:
        from app.llm.prompts.impact import VALID_IMPACT_LEVELS

        assert orthodontics.vocabulary.impact_level_ids == VALID_IMPACT_LEVELS

    def test_hype_risks_match_both_definitions(self, orthodontics: RadarProfile) -> None:
        """impact.py and scoring.py declare hype risks separately but identically."""
        from app.llm.prompts.impact import VALID_HYPE_RISKS as IMPACT_HYPE_RISKS
        from app.llm.prompts.scoring import VALID_HYPE_RISKS as SCORING_HYPE_RISKS

        assert IMPACT_HYPE_RISKS == SCORING_HYPE_RISKS
        assert orthodontics.vocabulary.hype_risk_ids == IMPACT_HYPE_RISKS

    def test_impact_actions_match(self, orthodontics: RadarProfile) -> None:
        from app.llm.prompts.impact import VALID_RECOMMENDED_ACTIONS

        assert orthodontics.vocabulary.impact_action_ids == VALID_RECOMMENDED_ACTIONS

    def test_scoring_actions_match(self, orthodontics: RadarProfile) -> None:
        from app.llm.prompts.scoring import VALID_RECOMMENDED_ACTIONS

        assert orthodontics.vocabulary.scoring_action_ids == VALID_RECOMMENDED_ACTIONS

    def test_impact_and_scoring_action_sets_genuinely_differ(self) -> None:
        """Documents a real inconsistency in the original code, kept deliberately."""
        from app.llm.prompts.impact import VALID_RECOMMENDED_ACTIONS as IMPACT_ACTIONS
        from app.llm.prompts.scoring import VALID_RECOMMENDED_ACTIONS as SCORING_ACTIONS

        assert IMPACT_ACTIONS != SCORING_ACTIONS
        assert frozenset({"act_now", "archive"}) == IMPACT_ACTIONS - SCORING_ACTIONS
        assert frozenset({"test", "discard"}) == SCORING_ACTIONS - IMPACT_ACTIONS


class TestSummaryParity:
    def test_summary_languages_cover_required_fields(
        self, orthodontics: RadarProfile
    ) -> None:
        from app.llm.prompts.summary import REQUIRED_SUMMARY_FIELDS

        expected = {f"summary_{code}" for code in orthodontics.summary.languages}

        assert expected <= REQUIRED_SUMMARY_FIELDS


class TestSourceParity:
    def test_declares_every_connector_seeded_in_the_database(
        self, orthodontics: RadarProfile
    ) -> None:
        seeded = {
            "pubmed",
            "arxiv",
            "clinical_trials",
            "crossref",
            "semantic_scholar",
        }

        assert {source.connector for source in orthodontics.sources} == seeded

    def test_pubmed_query_matches_the_connector_default(
        self, orthodontics: RadarProfile
    ) -> None:
        from app.connectors.pubmed import DEFAULT_QUERY

        pubmed = next(s for s in orthodontics.sources if s.connector == "pubmed")

        assert _terms(pubmed.query or "") == _terms(DEFAULT_QUERY)


def _terms(query: str) -> set[str]:
    """Split a boolean query into comparable terms, ignoring formatting."""
    normalised = query.replace("(", " ").replace(")", " ").lower()
    return {
        term.strip()
        for term in normalised.split(" or ")
        if term.strip() and term.strip() != "and"
    }
