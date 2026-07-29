"""Tests for CHECK constraints defined in migration 0001 and SQLAlchemy models.

Verifies that all CHECK constraints reject invalid values at the database level.
Uses the Alembic migration path (sync SQLite) to create the schema, then raw SQL
to test constraint enforcement.
"""

import uuid

import pytest
from sqlalchemy import create_engine, text

from alembic import command


@pytest.fixture
def db_engine(alembic_config):
    """Run migration and return a connected engine."""
    cfg, db_url = alembic_config
    command.upgrade(cfg, "0001")
    engine = create_engine(db_url)
    yield engine
    engine.dispose()


def _insert_source(conn, **overrides):
    """Helper: insert a source row, returning its id."""
    defaults = {
        "id": str(uuid.uuid4()),
        "name": "Test Source",
        "source_type": "api",
        "category": "core",
        "priority": 5,
        "enabled": 1,
        "config": "{}",
    }
    defaults.update(overrides)
    conn.execute(
        text(
            "INSERT INTO sources (id, name, source_type, category, priority, enabled, config) "
            "VALUES (:id, :name, :source_type, :category, :priority, :enabled, :config)"
        ),
        defaults,
    )
    conn.commit()
    return defaults["id"]


# ── Sources CHECK constraints ──────────────────────────────────────────────


class TestSourceCheckConstraints:
    """CHECK constraints on the sources table."""

    def test_valid_source_types(self, db_engine):
        """All valid source_type values are accepted."""
        with db_engine.connect() as conn:
            for st in ("api", "rss", "scraper"):
                _insert_source(conn, id=str(uuid.uuid4()), source_type=st)

    def test_invalid_source_type_rejected(self, db_engine):
        """Invalid source_type is rejected by chk_source_type."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_source(conn, source_type="graphql")

    def test_valid_categories(self, db_engine):
        """All valid category values are accepted."""
        with db_engine.connect() as conn:
            for cat in ("core", "university", "journal", "author"):
                _insert_source(conn, id=str(uuid.uuid4()), category=cat)

    def test_invalid_category_rejected(self, db_engine):
        """Invalid category is rejected by chk_source_category."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_source(conn, category="blog")

    def test_priority_valid_range(self, db_engine):
        """Priority values 1 through 10 are accepted."""
        with db_engine.connect() as conn:
            for p in (1, 5, 10):
                _insert_source(conn, id=str(uuid.uuid4()), priority=p)

    def test_priority_zero_rejected(self, db_engine):
        """Priority 0 is rejected by chk_source_priority."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_source(conn, priority=0)

    def test_priority_eleven_rejected(self, db_engine):
        """Priority 11 is rejected by chk_source_priority."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_source(conn, priority=11)


# ── Research Items CHECK constraints ───────────────────────────────────────


def _insert_research_item(conn, source_id, **overrides):
    """Helper: insert a research_item row."""
    defaults = {
        "id": str(uuid.uuid4()),
        "source_id": source_id,
        "original_title": "Test Paper",
        "document_type": "paper",
        "review_status": "review",
        "language": "en",
    }
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    params = ", ".join(f":{k}" for k in defaults.keys())
    conn.execute(text(f"INSERT INTO research_items ({cols}) VALUES ({params})"), defaults)
    conn.commit()


class TestResearchItemCheckConstraints:
    """CHECK constraints on the research_items table."""

    @pytest.fixture(autouse=True)
    def _source(self, db_engine):
        """Insert a parent source for FK reference."""
        with db_engine.connect() as conn:
            self.source_id = _insert_source(conn)
        self.engine = db_engine

    def test_valid_document_types(self):
        """All valid document_type values are accepted."""
        valid_types = (
            "paper", "review", "clinical_trial", "preprint",
            "university_publication", "journal_article", "strategic_signal",
        )
        with self.engine.connect() as conn:
            for dt in valid_types:
                _insert_research_item(conn, self.source_id, id=str(uuid.uuid4()), document_type=dt)

    def test_invalid_document_type_rejected(self):
        """Invalid document_type is rejected by chk_document_type."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, document_type="blog_post")

    def test_valid_review_statuses(self):
        """All valid review_status values are accepted."""
        for rs in ("relevant", "review", "discarded", "opportunity", "follow_up"):
            with self.engine.connect() as conn:
                _insert_research_item(
                    conn, self.source_id, id=str(uuid.uuid4()), review_status=rs
                )

    def test_invalid_review_status_rejected(self):
        """Invalid review_status is rejected by chk_review_status."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, review_status="approved")

    def test_valid_hype_risk_values(self):
        """All valid hype_risk values (including NULL) are accepted."""
        with self.engine.connect() as conn:
            for hr in ("low", "medium", "high"):
                _insert_research_item(
                    conn, self.source_id, id=str(uuid.uuid4()), hype_risk=hr
                )
            # NULL is also valid
            _insert_research_item(conn, self.source_id, id=str(uuid.uuid4()))

    def test_invalid_hype_risk_rejected(self):
        """Invalid hype_risk is rejected by chk_hype_risk."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, hype_risk="extreme")

    def test_valid_time_horizon_values(self):
        """All valid time_horizon values (including NULL) are accepted."""
        with self.engine.connect() as conn:
            for th in ("immediate", "short_term", "medium_term", "long_term"):
                _insert_research_item(
                    conn, self.source_id, id=str(uuid.uuid4()), time_horizon=th
                )

    def test_invalid_time_horizon_rejected(self):
        """Invalid time_horizon is rejected by chk_time_horizon."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, time_horizon="infinite")

    def test_valid_recommended_actions(self):
        """All valid recommended_action values are accepted."""
        with self.engine.connect() as conn:
            for ra in ("monitor", "investigate", "test", "discard"):
                _insert_research_item(
                    conn, self.source_id, id=str(uuid.uuid4()), recommended_action=ra
                )

    def test_invalid_recommended_action_rejected(self):
        """Invalid recommended_action is rejected by chk_recommended_action."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, recommended_action="deploy")

    def test_confidence_level_valid_range(self):
        """Confidence level 0.0 to 1.0 is accepted."""
        with self.engine.connect() as conn:
            for cl in (0.0, 0.5, 1.0):
                _insert_research_item(
                    conn, self.source_id, id=str(uuid.uuid4()), confidence_level=cl
                )

    def test_confidence_level_negative_rejected(self):
        """Negative confidence_level is rejected by chk_confidence_level."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, confidence_level=-0.1)

    def test_confidence_level_above_one_rejected(self):
        """Confidence level > 1 is rejected by chk_confidence_level."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(conn, self.source_id, confidence_level=1.5)

    def test_scientific_score_valid_range(self):
        """Scientific strength score 0.0 to 10.0 is accepted."""
        with self.engine.connect() as conn:
            for score in (0.0, 5.5, 10.0):
                _insert_research_item(
                    conn, self.source_id,
                    id=str(uuid.uuid4()),
                    scientific_strength_score=score,
                )

    def test_scientific_score_negative_rejected(self):
        """Negative scientific score is rejected by chk_scientific_strength_score."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(
                    conn, self.source_id, scientific_strength_score=-1.0
                )

    def test_scientific_score_above_ten_rejected(self):
        """Scientific score > 10 is rejected by chk_scientific_strength_score."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(
                    conn, self.source_id, scientific_strength_score=10.5
                )

    def test_strategic_score_valid_range(self):
        """Strategic relevance score 0.0 to 10.0 is accepted."""
        with self.engine.connect() as conn:
            for score in (0.0, 7.25, 10.0):
                _insert_research_item(
                    conn, self.source_id,
                    id=str(uuid.uuid4()),
                    strategic_relevance_score=score,
                )

    def test_strategic_score_negative_rejected(self):
        """Negative strategic score is rejected by chk_strategic_relevance_score."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(
                    conn, self.source_id, strategic_relevance_score=-0.5
                )

    def test_strategic_score_above_ten_rejected(self):
        """Strategic score > 10 is rejected by chk_strategic_relevance_score."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_research_item(
                    conn, self.source_id, strategic_relevance_score=11.0
                )


# ── Ingestion Runs CHECK constraints ──────────────────────────────────────


def _insert_ingestion_run(conn, source_id, **overrides):
    """Helper: insert an ingestion_run row."""
    defaults = {
        "id": str(uuid.uuid4()),
        "source_id": source_id,
        "status": "running",
        "items_fetched": 0,
        "items_new": 0,
        "items_duplicate": 0,
        "items_processed": 0,
    }
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    params = ", ".join(f":{k}" for k in defaults.keys())
    conn.execute(text(f"INSERT INTO ingestion_runs ({cols}) VALUES ({params})"), defaults)
    conn.commit()


class TestIngestionRunCheckConstraints:
    """CHECK constraints on the ingestion_runs table."""

    @pytest.fixture(autouse=True)
    def _source(self, db_engine):
        with db_engine.connect() as conn:
            self.source_id = _insert_source(conn)
        self.engine = db_engine

    def test_valid_statuses(self):
        """All valid status values are accepted."""
        with self.engine.connect() as conn:
            for status in ("running", "completed", "failed"):
                _insert_ingestion_run(
                    conn, self.source_id, id=str(uuid.uuid4()), status=status
                )

    def test_invalid_status_rejected(self):
        """Invalid status is rejected by chk_run_status."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_ingestion_run(conn, self.source_id, status="cancelled")

    def test_items_non_negative_accepted(self):
        """Zero and positive item counts are accepted."""
        with self.engine.connect() as conn:
            _insert_ingestion_run(
                conn, self.source_id,
                items_fetched=100,
                items_new=50,
                items_duplicate=30,
                items_processed=50,
            )

    def test_items_fetched_negative_rejected(self):
        """Negative items_fetched is rejected by chk_items_non_negative."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_ingestion_run(conn, self.source_id, items_fetched=-1)

    def test_items_new_negative_rejected(self):
        """Negative items_new is rejected by chk_items_non_negative."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_ingestion_run(conn, self.source_id, items_new=-1)

    def test_items_duplicate_negative_rejected(self):
        """Negative items_duplicate is rejected by chk_items_non_negative."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_ingestion_run(conn, self.source_id, items_duplicate=-1)

    def test_items_processed_negative_rejected(self):
        """Negative items_processed is rejected by chk_items_non_negative."""
        with self.engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_ingestion_run(conn, self.source_id, items_processed=-1)


# ── Daily Digests CHECK constraints ───────────────────────────────────────


def _insert_daily_digest(conn, **overrides):
    """Helper: insert a daily_digests row."""
    defaults = {
        "id": str(uuid.uuid4()),
        "digest_date": "2024-06-15",
        "items_included": "[]",
        "delivery_channel": "teams",
        "delivery_status": "pending",
    }
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    params = ", ".join(f":{k}" for k in defaults.keys())
    conn.execute(text(f"INSERT INTO daily_digests ({cols}) VALUES ({params})"), defaults)
    conn.commit()


class TestDailyDigestCheckConstraints:
    """CHECK constraints on the daily_digests table."""

    def test_valid_delivery_channels(self, db_engine):
        """All valid delivery_channel values are accepted."""
        with db_engine.connect() as conn:
            for ch in ("teams", "email"):
                _insert_daily_digest(conn, id=str(uuid.uuid4()), delivery_channel=ch)

    def test_invalid_delivery_channel_rejected(self, db_engine):
        """Invalid delivery_channel is rejected by chk_delivery_channel."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_daily_digest(conn, delivery_channel="slack")

    def test_valid_delivery_statuses(self, db_engine):
        """All valid delivery_status values are accepted."""
        with db_engine.connect() as conn:
            for st in ("pending", "sent", "failed"):
                _insert_daily_digest(conn, id=str(uuid.uuid4()), delivery_status=st)

    def test_invalid_delivery_status_rejected(self, db_engine):
        """Invalid delivery_status is rejected by chk_delivery_status."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_daily_digest(conn, delivery_status="cancelled")


# ── Configuration CHECK constraints ───────────────────────────────────────


def _insert_configuration(conn, **overrides):
    """Helper: insert a configuration row."""
    defaults = {
        "id": str(uuid.uuid4()),
        "category": "general",
        "key": f"test_key_{uuid.uuid4().hex[:8]}",
        "value": '{"k": "v"}',
    }
    defaults.update(overrides)
    cols = ", ".join(defaults.keys())
    params = ", ".join(f":{k}" for k in defaults.keys())
    conn.execute(text(f"INSERT INTO configuration ({cols}) VALUES ({params})"), defaults)
    conn.commit()


class TestConfigurationCheckConstraints:
    """CHECK constraints on the configuration table."""

    def test_valid_categories(self, db_engine):
        """All valid category values are accepted."""
        with db_engine.connect() as conn:
            for cat in ("thematic", "scoring", "delivery", "llm", "general", "sources"):
                _insert_configuration(conn, id=str(uuid.uuid4()), category=cat)

    def test_invalid_category_rejected(self, db_engine):
        """Invalid category is rejected by chk_config_category."""
        with db_engine.connect() as conn:
            with pytest.raises(Exception):
                _insert_configuration(conn, category="custom")
