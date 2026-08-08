"""Contract consistency tests.

Verifies that LLM service output values match database check constraints.
These tests prevent the situation where an LLM service returns a value
that violates a DB constraint, causing a runtime crash on deploy.
"""

import re

import pytest

# ─── Extract allowed values from services ────────────────────────────


def _get_service_valid_set(module_path: str, attr_name: str) -> set[str]:
    """Import a module and return a set attribute by name."""
    import importlib

    mod = importlib.import_module(module_path)
    return set(getattr(mod, attr_name))


def _get_constraint_values(migration_path: str, constraint_name: str) -> set[str]:
    """Parse a migration file and extract allowed values from a named constraint.

    Looks for create_check_constraint calls in the upgrade() function only.
    """
    with open(migration_path) as f:
        content = f.read()

    # Only look in the upgrade function (before downgrade)
    upgrade_section = content.split("def downgrade")[0] if "def downgrade" in content else content

    # Find the constraint by name - look for the IN clause on the SAME or NEXT lines
    # Pattern: "constraint_name" followed by IN (...) within the same statement
    pattern = rf'"{constraint_name}"[^)]*?IN\s*\n?\s*"?\(?([^)]+)\)'
    matches = re.findall(pattern, upgrade_section, re.DOTALL)
    if not matches:
        # Try simpler pattern
        pattern2 = rf'"{constraint_name}".*?IN\s*\((.*?)\)'
        matches = re.findall(pattern2, upgrade_section, re.DOTALL)

    if not matches:
        pytest.fail(f"Could not find constraint {constraint_name} in {migration_path}")

    # Use the FIRST match from upgrade section
    values_str = matches[0]
    values = set(re.findall(r"'([^']+)'", values_str))
    return values


# ─── Migration and service paths ─────────────────────────────────────

MIGRATION_0001 = "alembic/versions/0001_initial_schema.py"
MIGRATION_0005 = "alembic/versions/0005_relax_check_constraints.py"


class TestHypeRiskConsistency:
    """Verify hype_risk values are consistent across services and DB."""

    def test_scoring_hype_risk_fits_db_constraint(self):

        service_values = {"low", "medium", "high"}  # From VALID_HYPE_RISKS
        db_values = _get_constraint_values(MIGRATION_0005, "chk_hype_risk")
        missing = service_values - db_values
        assert not missing, f"Scoring service hype_risk values {missing} not in DB constraint {db_values}"

    def test_impact_hype_risk_fits_db_constraint(self):

        service_values = {"low", "medium", "high"}  # From VALID_HYPE_RISKS
        db_values = _get_constraint_values(MIGRATION_0005, "chk_hype_risk")
        missing = service_values - db_values
        assert not missing, f"Impact service hype_risk values {missing} not in DB constraint {db_values}"


class TestRecommendedActionConsistency:
    """Verify recommended_action values are consistent across services and DB."""

    def test_scoring_recommended_action_fits_db_constraint(self):
        service_values = {"monitor", "investigate", "test", "discard"}
        db_values = _get_constraint_values(MIGRATION_0005, "chk_recommended_action")
        missing = service_values - db_values
        assert not missing, f"Scoring recommended_action values {missing} not in DB constraint {db_values}"

    def test_impact_recommended_action_fits_db_constraint(self):
        service_values = {"monitor", "investigate", "act_now", "archive"}
        db_values = _get_constraint_values(MIGRATION_0005, "chk_recommended_action")
        missing = service_values - db_values
        assert not missing, f"Impact recommended_action values {missing} not in DB constraint {db_values}"

    def test_all_service_values_covered_by_db(self):
        """ALL values from ALL services must be in the DB constraint."""
        scoring_values = {"monitor", "investigate", "test", "discard"}
        impact_values = {"monitor", "investigate", "act_now", "archive"}
        all_service_values = scoring_values | impact_values
        db_values = _get_constraint_values(MIGRATION_0005, "chk_recommended_action")
        missing = all_service_values - db_values
        assert not missing, f"Service recommended_action values {missing} not in DB constraint {db_values}"


class TestTimeHorizonConsistency:
    """Verify time_horizon values are consistent across services and DB."""

    def test_strategic_time_horizon_fits_db_constraint(self):
        service_values = {"immediate", "short_term", "medium_term", "long_term"}
        db_values = _get_constraint_values(MIGRATION_0005, "chk_time_horizon")
        missing = service_values - db_values
        assert not missing, f"Strategic time_horizon values {missing} not in DB constraint {db_values}"


class TestReviewStatusConsistency:
    """Verify review_status values match between frontend types and DB."""

    def test_review_status_constraint_exists(self):
        """Check review_status constraint directly from migration text."""
        with open(MIGRATION_0001) as f:
            content = f.read()
        # Find the specific review_status constraint text
        assert "'relevant'" in content
        assert "'review'" in content
        assert "'discarded'" in content
        assert "'opportunity'" in content
        assert "'follow_up'" in content


class TestColumnWidths:
    """Verify string column widths can hold all possible values."""

    def test_hype_risk_column_width(self):
        from app.models.research_item import ResearchItem

        col = ResearchItem.__table__.columns["hype_risk"]
        max_len = col.type.length
        all_values = {"low", "medium", "high"}
        for v in all_values:
            assert len(v) <= max_len, f"hype_risk value '{v}' ({len(v)} chars) exceeds column width {max_len}"

    def test_recommended_action_column_width(self):
        from app.models.research_item import ResearchItem

        col = ResearchItem.__table__.columns["recommended_action"]
        max_len = col.type.length
        all_values = {"monitor", "investigate", "test", "discard", "act_now", "archive"}
        for v in all_values:
            assert len(v) <= max_len, (
                f"recommended_action value '{v}' ({len(v)} chars) exceeds column width {max_len}"
            )

    def test_time_horizon_column_width(self):
        from app.models.research_item import ResearchItem

        col = ResearchItem.__table__.columns["time_horizon"]
        max_len = col.type.length
        all_values = {"immediate", "short_term", "medium_term", "long_term"}
        for v in all_values:
            assert len(v) <= max_len, (
                f"time_horizon value '{v}' ({len(v)} chars) exceeds column width {max_len}"
            )

    def test_review_status_column_width(self):
        from app.models.research_item import ResearchItem

        col = ResearchItem.__table__.columns["review_status"]
        max_len = col.type.length
        all_values = {"relevant", "review", "discarded", "opportunity", "follow_up"}
        for v in all_values:
            assert len(v) <= max_len, (
                f"review_status value '{v}' ({len(v)} chars) exceeds column width {max_len}"
            )


# ─── Profile schema vs LLM provider registry ─────────────────────────


class TestProviderContract:
    """Every provider a profile may name has to exist at run time.

    The profile schema validates `llm.provider` against a closed set. A value
    in that set with no registered provider passes validation and then fails
    when the pipeline asks the registry for it -- the profile looks fine and
    the radar dies on its first run. This test keeps the two in step.
    """

    @staticmethod
    def _accepted_by_the_profile_schema() -> set[str]:
        from typing import get_args

        from app.profiles.schema import LLMSettings

        return set(get_args(LLMSettings.model_fields["provider"].annotation))

    @staticmethod
    def _registered_in_the_engine() -> set[str]:
        import app.llm.anthropic_provider  # noqa: F401
        import app.llm.ollama_provider  # noqa: F401
        import app.llm.openai_provider  # noqa: F401
        from app.llm import default_registry

        return set(default_registry.registered_names)

    def test_every_accepted_provider_is_registered(self):
        missing = self._accepted_by_the_profile_schema() - self._registered_in_the_engine()
        assert not missing, (
            f"the profile schema accepts {sorted(missing)} but the engine has no such "
            "provider; a profile naming one would validate and then fail at startup"
        )

    def test_every_registered_provider_is_accepted(self):
        unreachable = self._registered_in_the_engine() - self._accepted_by_the_profile_schema()
        assert not unreachable, (
            f"{sorted(unreachable)} is registered but no profile can ask for it, "
            "because the profile schema does not accept the name"
        )
