"""Tests for migration 0001 - initial schema."""

from sqlalchemy import create_engine, inspect

from alembic import command

EXPECTED_TABLES = {"sources", "research_items", "configuration", "ingestion_runs", "daily_digests"}

EXPECTED_COLUMNS = {
    "sources": {
        "id", "name", "source_type", "category", "priority", "enabled",
        "config", "base_url", "last_fetched_at", "created_at", "updated_at",
    },
    "research_items": {
        "id", "source_id",
        "doi", "pmid", "nct_id", "arxiv_id", "original_url",
        "original_title", "normalized_title", "authors", "publication_date",
        "abstract", "journal_or_origin", "document_type", "language",
        "thematic_tags", "strategic_buckets",
        "scientific_strength_score", "scientific_strength_reasons",
        "strategic_relevance_score", "strategic_relevance_reasons",
        "hype_risk", "time_horizon", "recommended_action", "confidence_level",
        "facts_from_source", "extracted_evidence", "evidence_snippets",
        "strategic_interpretation",
        "executive_summary_en", "executive_summary_es",
        "why_it_matters_en", "why_it_matters_es",
        "possible_impact_for_geniova_en", "possible_impact_for_geniova_es",
        "review_status",
        "llm_provider", "llm_model", "llm_prompt_version",
        "raw_llm_input", "raw_llm_output",
        "processing_timestamp", "created_at", "updated_at",
        "content_hash",
    },
    "configuration": {
        "id", "category", "key", "value", "description",
        "created_at", "updated_at",
    },
    "ingestion_runs": {
        "id", "source_id", "started_at", "completed_at", "status",
        "items_fetched", "items_new", "items_duplicate", "items_processed",
        "errors", "created_at", "updated_at",
    },
    "daily_digests": {
        "id", "digest_date", "items_included", "delivery_channel",
        "delivery_status", "payload", "sent_at", "created_at", "updated_at",
    },
}


def test_upgrade_head_creates_all_tables(alembic_config):
    """Upgrade head creates all 5 application tables."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    assert EXPECTED_TABLES.issubset(tables)
    assert "alembic_version" in tables


def test_sources_columns(alembic_config):
    """Sources table has all expected columns."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("sources")}

    assert EXPECTED_COLUMNS["sources"] == columns


def test_research_items_columns(alembic_config):
    """Research items table has all expected columns."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("research_items")}

    assert EXPECTED_COLUMNS["research_items"] == columns


def test_configuration_columns(alembic_config):
    """Configuration table has all expected columns."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("configuration")}

    assert EXPECTED_COLUMNS["configuration"] == columns


def test_ingestion_runs_columns(alembic_config):
    """Ingestion runs table has all expected columns."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("ingestion_runs")}

    assert EXPECTED_COLUMNS["ingestion_runs"] == columns


def test_daily_digests_columns(alembic_config):
    """Daily digests table has all expected columns."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("daily_digests")}

    assert EXPECTED_COLUMNS["daily_digests"] == columns


def test_content_hash_unique_constraint(alembic_config):
    """Research items content_hash has a unique constraint."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    unique_constraints = inspector.get_unique_constraints("research_items")
    unique_columns = [uc["column_names"] for uc in unique_constraints]

    assert ["content_hash"] in unique_columns


def test_configuration_category_key_unique(alembic_config):
    """Configuration has a unique constraint on (category, key)."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    unique_constraints = inspector.get_unique_constraints("configuration")
    unique_columns = [uc["column_names"] for uc in unique_constraints]

    assert ["category", "key"] in unique_columns


def test_basic_indexes_created(alembic_config):
    """Basic cross-dialect indexes are created."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")

    engine = create_engine(db_url)
    inspector = inspect(engine)

    sources_indexes = {idx["name"] for idx in inspector.get_indexes("sources")}
    assert "idx_sources_category" in sources_indexes
    assert "idx_sources_last_fetched" in sources_indexes

    ri_indexes = {idx["name"] for idx in inspector.get_indexes("research_items")}
    assert "idx_research_items_source_id" in ri_indexes
    assert "idx_research_items_review_status" in ri_indexes
    assert "idx_research_items_document_type" in ri_indexes

    ir_indexes = {idx["name"] for idx in inspector.get_indexes("ingestion_runs")}
    assert "idx_ingestion_runs_source_id" in ir_indexes
    assert "idx_ingestion_runs_status" in ir_indexes

    cfg_indexes = {idx["name"] for idx in inspector.get_indexes("configuration")}
    assert "idx_configuration_category" in cfg_indexes


def test_downgrade_base_removes_all_tables(alembic_config):
    """Downgrade to base removes all application tables."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")
    command.downgrade(cfg, "base")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    for table in EXPECTED_TABLES:
        assert table not in tables


def test_migration_tables_match_models(alembic_config):
    """Migration-created tables match SQLAlchemy model metadata."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    migration_tables = set(inspector.get_table_names()) - {"alembic_version"}

    from app.models import Base
    model_tables = set(Base.metadata.tables.keys())

    assert model_tables == migration_tables


def test_migration_columns_match_models(alembic_config):
    """Migration-created columns match SQLAlchemy model columns for each table."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)

    from app.models import Base
    for table_name, table in Base.metadata.tables.items():
        model_columns = {c.name for c in table.columns}
        migration_columns = {c["name"] for c in inspector.get_columns(table_name)}
        assert model_columns == migration_columns, f"Column mismatch for {table_name}"


def test_upgrade_works_with_aiosqlite_url(alembic_config_aiosqlite):
    """R-1 regression: sqlite+aiosqlite:// URL must work via run_sync_migrations.

    env.py strips the +aiosqlite prefix before calling create_engine, so the
    migration runs through the sync SQLite path without error.
    """
    cfg, sync_url = alembic_config_aiosqlite
    command.upgrade(cfg, "0001")

    engine = create_engine(sync_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    assert EXPECTED_TABLES.issubset(tables)


def test_full_cycle_with_aiosqlite_url(alembic_config_aiosqlite):
    """R-1 regression: full upgrade/downgrade cycle with sqlite+aiosqlite:// URL."""
    cfg, sync_url = alembic_config_aiosqlite
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    engine = create_engine(sync_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    assert EXPECTED_TABLES.issubset(tables)
