"""Initial schema - tables, constraints, indexes, triggers

Revision ID: 0001
Revises:
Create Date: 2026-03-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # Dialect-specific helpers
    jsonb = postgresql.JSONB(astext_type=sa.Text()) if is_pg else sa.JSON()
    uuid_default = sa.text("gen_random_uuid()") if is_pg else None
    now_default = sa.text("now()") if is_pg else sa.text("CURRENT_TIMESTAMP")

    # Enable pgcrypto for gen_random_uuid()
    if is_pg:
        op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    # ---- sources ----
    op.create_table(
        "sources",
        sa.Column("id", sa.Uuid(), server_default=uuid_default, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("priority", sa.Integer(), server_default=sa.text("5"), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("config", jsonb),
        sa.Column("base_url", sa.Text()),
        sa.Column("last_fetched_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("source_type IN ('api', 'rss', 'scraper')", name="chk_source_type"),
        sa.CheckConstraint("category IN ('core', 'university', 'journal', 'author')", name="chk_source_category"),
        sa.CheckConstraint("priority BETWEEN 1 AND 10", name="chk_source_priority"),
    )

    # ---- research_items ----
    op.create_table(
        "research_items",
        sa.Column("id", sa.Uuid(), server_default=uuid_default, nullable=False),
        sa.Column(
            "source_id", sa.Uuid(), sa.ForeignKey("sources.id", ondelete="RESTRICT"), nullable=False
        ),
        # Identification
        sa.Column("doi", sa.String(255)),
        sa.Column("pmid", sa.String(20)),
        sa.Column("nct_id", sa.String(20)),
        sa.Column("arxiv_id", sa.String(50)),
        sa.Column("original_url", sa.Text()),
        # Content
        sa.Column("original_title", sa.Text(), nullable=False),
        sa.Column("normalized_title", sa.Text()),
        sa.Column("authors", jsonb),
        sa.Column("publication_date", sa.Date()),
        sa.Column("abstract", sa.Text()),
        sa.Column("journal_or_origin", sa.String(500)),
        sa.Column("document_type", sa.String(30), nullable=False),
        sa.Column("language", sa.String(10), server_default=sa.text("'en'")),
        # Classification
        sa.Column("thematic_tags", jsonb),
        sa.Column("strategic_buckets", jsonb),
        # Scoring
        sa.Column("scientific_strength_score", sa.Numeric(4, 2)),
        sa.Column("scientific_strength_reasons", jsonb),
        sa.Column("strategic_relevance_score", sa.Numeric(4, 2)),
        sa.Column("strategic_relevance_reasons", jsonb),
        # Strategic analysis
        sa.Column("hype_risk", sa.String(10)),
        sa.Column("time_horizon", sa.String(15)),
        sa.Column("recommended_action", sa.String(15)),
        sa.Column("confidence_level", sa.Numeric(3, 2)),
        # Evidence
        sa.Column("facts_from_source", jsonb),
        sa.Column("extracted_evidence", jsonb),
        sa.Column("evidence_snippets", jsonb),
        sa.Column("strategic_interpretation", jsonb),
        # Executive output
        sa.Column("executive_summary_en", sa.Text()),
        sa.Column("executive_summary_es", sa.Text()),
        sa.Column("why_it_matters_en", sa.Text()),
        sa.Column("why_it_matters_es", sa.Text()),
        sa.Column("possible_impact_en", sa.Text()),
        sa.Column("possible_impact_es", sa.Text()),
        # Review
        sa.Column("review_status", sa.String(15), server_default=sa.text("'review'"), nullable=False),
        # LLM audit trail
        sa.Column("llm_provider", sa.String(50)),
        sa.Column("llm_model", sa.String(100)),
        sa.Column("llm_prompt_version", sa.String(50)),
        sa.Column("raw_llm_input", sa.Text()),
        sa.Column("raw_llm_output", sa.Text()),
        # Timestamps
        sa.Column("processing_timestamp", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        # Deduplication
        sa.Column("content_hash", sa.String(64), unique=True),
        sa.PrimaryKeyConstraint("id"),
        # CHECK constraints
        sa.CheckConstraint(
            "document_type IN ('paper', 'review', 'clinical_trial', 'preprint', "
            "'university_publication', 'journal_article', 'strategic_signal')",
            name="chk_document_type",
        ),
        sa.CheckConstraint(
            "hype_risk IS NULL OR hype_risk IN ('low', 'medium', 'high')",
            name="chk_hype_risk",
        ),
        sa.CheckConstraint(
            "time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')",
            name="chk_time_horizon",
        ),
        sa.CheckConstraint(
            "recommended_action IS NULL OR recommended_action IN "
            "('monitor', 'investigate', 'test', 'discard')",
            name="chk_recommended_action",
        ),
        sa.CheckConstraint(
            "review_status IN ('relevant', 'review', 'discarded', 'opportunity', 'follow_up')",
            name="chk_review_status",
        ),
        sa.CheckConstraint(
            "confidence_level IS NULL OR (confidence_level >= 0 AND confidence_level <= 1)",
            name="chk_confidence_level",
        ),
        sa.CheckConstraint(
            "scientific_strength_score IS NULL OR "
            "(scientific_strength_score >= 0 AND scientific_strength_score <= 10)",
            name="chk_scientific_strength_score",
        ),
        sa.CheckConstraint(
            "strategic_relevance_score IS NULL OR "
            "(strategic_relevance_score >= 0 AND strategic_relevance_score <= 10)",
            name="chk_strategic_relevance_score",
        ),
    )

    # ---- configuration ----
    op.create_table(
        "configuration",
        sa.Column("id", sa.Uuid(), server_default=uuid_default, nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", jsonb, nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category", "key", name="uq_configuration_category_key"),
        sa.CheckConstraint(
            "category IN ('thematic', 'scoring', 'delivery', 'llm', 'general', 'sources')",
            name="chk_config_category",
        ),
    )

    # ---- ingestion_runs ----
    op.create_table(
        "ingestion_runs",
        sa.Column("id", sa.Uuid(), server_default=uuid_default, nullable=False),
        sa.Column(
            "source_id", sa.Uuid(), sa.ForeignKey("sources.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(15), server_default=sa.text("'running'"), nullable=False),
        sa.Column("items_fetched", sa.Integer(), server_default=sa.text("0")),
        sa.Column("items_new", sa.Integer(), server_default=sa.text("0")),
        sa.Column("items_duplicate", sa.Integer(), server_default=sa.text("0")),
        sa.Column("items_processed", sa.Integer(), server_default=sa.text("0")),
        sa.Column("errors", jsonb),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'failed')",
            name="chk_run_status",
        ),
        sa.CheckConstraint(
            "items_fetched >= 0 AND items_new >= 0 AND items_duplicate >= 0 AND items_processed >= 0",
            name="chk_items_non_negative",
        ),
    )

    # ---- daily_digests ----
    op.create_table(
        "daily_digests",
        sa.Column("id", sa.Uuid(), server_default=uuid_default, nullable=False),
        sa.Column("digest_date", sa.Date(), nullable=False),
        sa.Column("items_included", jsonb, nullable=False),
        sa.Column("delivery_channel", sa.String(10), nullable=False),
        sa.Column("delivery_status", sa.String(15), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("payload", jsonb),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now_default, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "delivery_channel IN ('teams', 'email')",
            name="chk_delivery_channel",
        ),
        sa.CheckConstraint(
            "delivery_status IN ('pending', 'sent', 'failed')",
            name="chk_delivery_status",
        ),
    )

    # =====================================================================
    # INDEXES - basic (all dialects)
    # =====================================================================

    # sources
    op.create_index("idx_sources_category", "sources", ["category"])
    op.create_index("idx_sources_last_fetched", "sources", ["last_fetched_at"])

    # research_items
    op.create_index("idx_research_items_source_id", "research_items", ["source_id"])
    op.create_index("idx_research_items_review_status", "research_items", ["review_status"])
    op.create_index("idx_research_items_document_type", "research_items", ["document_type"])

    # ingestion_runs
    op.create_index("idx_ingestion_runs_source_id", "ingestion_runs", ["source_id"])
    op.create_index("idx_ingestion_runs_status", "ingestion_runs", ["status"])

    # daily_digests
    op.create_index("idx_daily_digests_channel", "daily_digests", ["delivery_channel"])
    op.create_index("idx_daily_digests_status", "daily_digests", ["delivery_status"])

    # configuration
    op.create_index("idx_configuration_category", "configuration", ["category"])

    # =====================================================================
    # INDEXES - PostgreSQL-specific (partial, GIN, DESC NULLS LAST)
    # =====================================================================
    if is_pg:
        # Partial indexes
        op.create_index(
            "idx_sources_enabled", "sources", ["enabled"],
            postgresql_where=sa.text("enabled = TRUE"),
        )
        op.create_index(
            "idx_research_items_doi", "research_items", ["doi"],
            postgresql_where=sa.text("doi IS NOT NULL"),
        )
        op.create_index(
            "idx_research_items_pmid", "research_items", ["pmid"],
            postgresql_where=sa.text("pmid IS NOT NULL"),
        )
        op.create_index(
            "idx_research_items_nct_id", "research_items", ["nct_id"],
            postgresql_where=sa.text("nct_id IS NOT NULL"),
        )
        op.create_index(
            "idx_research_items_arxiv_id", "research_items", ["arxiv_id"],
            postgresql_where=sa.text("arxiv_id IS NOT NULL"),
        )
        op.create_index(
            "idx_research_items_recommended_action", "research_items", ["recommended_action"],
            postgresql_where=sa.text("recommended_action IS NOT NULL"),
        )
        op.create_index(
            "idx_research_items_time_horizon", "research_items", ["time_horizon"],
            postgresql_where=sa.text("time_horizon IS NOT NULL"),
        )

        # DESC / NULLS LAST indexes (raw SQL for complex expressions)
        op.execute(
            "CREATE INDEX idx_research_items_publication_date "
            "ON research_items (publication_date DESC)"
        )
        op.execute(
            "CREATE INDEX idx_research_items_scientific_score "
            "ON research_items (scientific_strength_score DESC NULLS LAST)"
        )
        op.execute(
            "CREATE INDEX idx_research_items_strategic_score "
            "ON research_items (strategic_relevance_score DESC NULLS LAST)"
        )
        op.execute(
            "CREATE INDEX idx_research_items_created_at "
            "ON research_items (created_at DESC)"
        )
        op.execute(
            "CREATE INDEX idx_research_items_processing_ts "
            "ON research_items (processing_timestamp DESC NULLS LAST)"
        )
        op.execute(
            "CREATE INDEX idx_ingestion_runs_started_at "
            "ON ingestion_runs (started_at DESC)"
        )
        op.execute(
            "CREATE INDEX idx_daily_digests_date "
            "ON daily_digests (digest_date DESC)"
        )

        # Composite indexes
        op.execute(
            "CREATE INDEX idx_research_items_status_strategic "
            "ON research_items (review_status, strategic_relevance_score DESC NULLS LAST)"
        )
        op.execute(
            "CREATE INDEX idx_research_items_status_date "
            "ON research_items (review_status, publication_date DESC)"
        )

        # GIN indexes on JSONB columns
        op.create_index(
            "idx_research_items_thematic_tags",
            "research_items",
            ["thematic_tags"],
            postgresql_using="gin",
            postgresql_ops={"thematic_tags": "jsonb_path_ops"},
        )
        op.create_index(
            "idx_research_items_strategic_buckets",
            "research_items",
            ["strategic_buckets"],
            postgresql_using="gin",
            postgresql_ops={"strategic_buckets": "jsonb_path_ops"},
        )
        op.create_index(
            "idx_research_items_authors",
            "research_items",
            ["authors"],
            postgresql_using="gin",
            postgresql_ops={"authors": "jsonb_path_ops"},
        )

    # =====================================================================
    # TRIGGERS - PostgreSQL only
    # =====================================================================
    if is_pg:
        op.execute(
            "CREATE OR REPLACE FUNCTION update_updated_at_column() "
            "RETURNS TRIGGER AS $$ "
            "BEGIN "
            "    NEW.updated_at = NOW(); "
            "    RETURN NEW; "
            "END; "
            "$$ LANGUAGE plpgsql"
        )
        op.execute(
            "CREATE TRIGGER trg_sources_updated_at "
            "BEFORE UPDATE ON sources "
            "FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()"
        )
        op.execute(
            "CREATE TRIGGER trg_research_items_updated_at "
            "BEFORE UPDATE ON research_items "
            "FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()"
        )
        op.execute(
            "CREATE TRIGGER trg_configuration_updated_at "
            "BEFORE UPDATE ON configuration "
            "FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()"
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # Drop triggers and function (PostgreSQL only)
    if is_pg:
        op.execute("DROP TRIGGER IF EXISTS trg_configuration_updated_at ON configuration")
        op.execute("DROP TRIGGER IF EXISTS trg_research_items_updated_at ON research_items")
        op.execute("DROP TRIGGER IF EXISTS trg_sources_updated_at ON sources")
        op.execute("DROP FUNCTION IF EXISTS update_updated_at_column()")

    # Drop tables in reverse dependency order
    op.drop_table("daily_digests")
    op.drop_table("ingestion_runs")
    op.drop_table("configuration")
    op.drop_table("research_items")
    op.drop_table("sources")

    if is_pg:
        op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
