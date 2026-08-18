"""Tests for migration 0008 - the injection scan record on research items.

The column is nullable on purpose, and that is the whole point of the
migration: NULL means the item predates the scan and nobody has looked at it,
while a stored record with no findings means somebody looked and the document
was clean. If the migration had backfilled a default, every item ingested
before the scan existed would claim to be clean.
"""

from sqlalchemy import create_engine, inspect, text

from alembic import command


def _columns(db_url, table):
    engine = create_engine(db_url)
    try:
        return {col["name"]: col for col in inspect(engine).get_columns(table)}
    finally:
        engine.dispose()


class TestInjectionScanColumn:
    def test_upgrade_adds_the_column(self, alembic_config):
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0008")

        assert "injection_scan" in _columns(db_url, "research_items")

    def test_the_column_is_nullable(self, alembic_config):
        """An item nobody has scanned must be able to say so."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0008")

        assert _columns(db_url, "research_items")["injection_scan"]["nullable"]

    def test_existing_rows_are_not_backfilled(self, alembic_config):
        """Backfilling a default would make every item ingested before the
        scan existed claim to have been scanned and found clean."""
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0007")

        engine = create_engine(db_url)
        try:
            with engine.begin() as conn:
                source_id = conn.execute(text("SELECT id FROM sources LIMIT 1")).scalar()
                conn.execute(
                    text(
                        "INSERT INTO research_items "
                        "(id, source_id, original_title, document_type, content_hash) "
                        "VALUES ('11111111-1111-1111-1111-111111111111', :sid, "
                        "'Pre-existing item', 'paper', 'hash-0008')"
                    ),
                    {"sid": source_id},
                )

            command.upgrade(cfg, "0008")

            with engine.connect() as conn:
                scan = conn.execute(
                    text("SELECT injection_scan FROM research_items WHERE content_hash = 'hash-0008'")
                ).scalar()
        finally:
            engine.dispose()

        assert scan is None

    def test_downgrade_removes_the_column(self, alembic_config):
        cfg, db_url = alembic_config
        command.upgrade(cfg, "0008")
        command.downgrade(cfg, "0007")

        assert "injection_scan" not in _columns(db_url, "research_items")
