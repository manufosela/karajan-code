"""Tests for migration 0002 - seed data."""

from sqlalchemy import create_engine, text

from alembic import command


def test_seed_data_inserts_sources(alembic_config):
    """Seed data migration inserts 5 default sources."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM sources"))
        count = result.scalar()

    assert count == 5


def test_seed_data_inserts_configuration(alembic_config):
    """Seed data migration inserts 9 configuration entries."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM configuration"))
        count = result.scalar()

    assert count == 9


def test_seed_data_source_names(alembic_config):
    """Seed data contains all expected source names."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    expected_names = {"PubMed", "arXiv", "ClinicalTrials.gov", "Crossref", "Semantic Scholar"}

    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT name FROM sources"))
        names = {row[0] for row in result}

    assert names == expected_names


def test_seed_data_configuration_categories(alembic_config):
    """Seed data covers all expected configuration categories."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    expected_categories = {"thematic", "scoring", "delivery", "llm", "general", "sources"}

    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT DISTINCT category FROM configuration"))
        categories = {row[0] for row in result}

    assert categories == expected_categories


def test_seed_data_downgrade_removes_data(alembic_config):
    """Downgrading seed data migration removes inserted rows but keeps tables."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0001")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        sources_count = conn.execute(text("SELECT COUNT(*) FROM sources")).scalar()
        config_count = conn.execute(text("SELECT COUNT(*) FROM configuration")).scalar()

    assert sources_count == 0
    assert config_count == 0


def test_full_upgrade_downgrade_cycle(alembic_config):
    """Full cycle: upgrade head -> downgrade base -> upgrade head works."""
    cfg, db_url = alembic_config

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        sources_count = conn.execute(text("SELECT COUNT(*) FROM sources")).scalar()
        config_count = conn.execute(text("SELECT COUNT(*) FROM configuration")).scalar()

    assert sources_count == 5
    assert config_count == 9
