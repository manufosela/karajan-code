"""Tests for migration 0011 - the orthodontics keyword row leaves the table.

The row was the last piece of a domain living in the database rather than in
the Radar Profile. Nothing reads it any more: the keyword panel takes its
groups from the profile (KRD-TSK-0023), and the topics endpoint stopped
serving it.
"""

from sqlalchemy import create_engine, text

from alembic import command

_ROW = {"category": "thematic", "key": "orthodontics_keywords"}


def _row_count(db_url: str) -> int:
    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            return conn.execute(
                text("SELECT COUNT(*) FROM configuration WHERE category = :category AND key = :key"),
                _ROW,
            ).scalar()
    finally:
        engine.dispose()


class TestOrthodonticsKeywordsLeaveTheTable:
    def test_the_seed_still_creates_the_row(self, alembic_config) -> None:
        """History is not rewritten: 0002 keeps seeding what it always did."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0010")

        assert _row_count(db_url) == 1

    def test_the_row_is_gone_at_head(self, alembic_config) -> None:
        cfg, db_url = alembic_config
        command.upgrade(cfg, "head")

        assert _row_count(db_url) == 0

    def test_the_other_thematic_rows_survive(self, alembic_config) -> None:
        cfg, db_url = alembic_config
        command.upgrade(cfg, "head")

        engine = create_engine(db_url)
        try:
            with engine.connect() as conn:
                keys = {
                    row[0]
                    for row in conn.execute(text("SELECT key FROM configuration WHERE category = 'thematic'"))
                }
        finally:
            engine.dispose()

        assert keys == {"strategic_buckets"}

    def test_a_database_without_the_row_is_not_an_error(self, alembic_config) -> None:
        """A fresh instance built from a profile need never have had it."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0010")

        engine = create_engine(db_url)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM configuration WHERE category = :category AND key = :key"),
                    _ROW,
                )
        finally:
            engine.dispose()

        command.upgrade(cfg, "head")

        assert _row_count(db_url) == 0

    def test_downgrade_does_not_resurrect_the_row(self, alembic_config) -> None:
        """Nothing reads the row, so putting a dead one back would only mislead."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "0010")

        assert _row_count(db_url) == 0
