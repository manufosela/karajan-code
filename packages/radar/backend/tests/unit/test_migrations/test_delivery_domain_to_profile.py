"""Tests for migration 0009 - delivery settings that are domain leave the table.

What this migration is really doing is removing something that looked like a
setting and was not: the digest read module constants, so raising the
threshold in this row changed nothing. Leaving the keys behind would keep
that illusion alive next to a profile that now genuinely governs.
"""

import json

from sqlalchemy import create_engine, text

from alembic import command

_MOVED_TO_PROFILE = {"teams_threshold", "max_daily_insights", "output_language", "include_sections"}
_STAYS_IN_THE_TABLE = {
    "digest_schedule",
    "digest_timezone",
    "teams_webhook_env",
    "email_recipients_env",
}


def _delivery_row(db_url: str) -> dict:
    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            raw = conn.execute(
                text(
                    "SELECT value FROM configuration "
                    "WHERE category = 'delivery' AND key = 'daily_digest_settings'"
                )
            ).scalar()
    finally:
        engine.dispose()

    return json.loads(raw) if isinstance(raw, str) else dict(raw)


class TestDeliveryDomainKeysLeaveTheTable:
    def test_the_domain_keys_are_gone(self, alembic_config) -> None:
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0009")

        assert _MOVED_TO_PROFILE & set(_delivery_row(db_url)) == set()

    def test_what_belongs_to_a_deployment_stays(self, alembic_config) -> None:
        """When the digest runs and where it is sent is not a domain
        judgement, and some of it is a secret's name."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0009")

        assert set(_delivery_row(db_url)) >= _STAYS_IN_THE_TABLE

    def test_the_row_itself_survives(self, alembic_config) -> None:
        """Dropping the row would take the deployment settings with it."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0009")

        assert _delivery_row(db_url)

    def test_downgrade_puts_the_seeded_values_back(self, alembic_config) -> None:
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0009")
        command.downgrade(cfg, "0008")

        restored = _delivery_row(db_url)

        assert set(restored) >= _MOVED_TO_PROFILE
        assert restored["teams_threshold"] == 6.0
        assert restored["max_daily_insights"] == 5

    def test_a_database_without_the_row_is_not_an_error(self, alembic_config) -> None:
        """A fresh instance built from a profile need never have had it."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0008")

        engine = create_engine(db_url)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM configuration WHERE category = 'delivery' AND key = :key"),
                    {"key": "daily_digest_settings"},
                )
        finally:
            engine.dispose()

        command.upgrade(cfg, "0009")
