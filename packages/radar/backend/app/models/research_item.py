import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.source import Source


class ResearchItem(Base):
    """SQLAlchemy model for the research_items table."""

    __tablename__ = "research_items"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Identification
    doi: Mapped[str | None] = mapped_column(String(255))
    pmid: Mapped[str | None] = mapped_column(String(20))
    nct_id: Mapped[str | None] = mapped_column(String(20))
    arxiv_id: Mapped[str | None] = mapped_column(String(50))
    original_url: Mapped[str | None] = mapped_column(Text)

    # Content
    original_title: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_title: Mapped[str | None] = mapped_column(Text)
    authors: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, default=list)
    publication_date: Mapped[date | None] = mapped_column(Date)
    abstract: Mapped[str | None] = mapped_column(Text)
    journal_or_origin: Mapped[str | None] = mapped_column(String(500))
    document_type: Mapped[str] = mapped_column(String(30), nullable=False)
    language: Mapped[str | None] = mapped_column(String(10), default="en", server_default="en")

    # Classification
    thematic_tags: Mapped[list[str] | None] = mapped_column(JSONB, default=list)
    strategic_buckets: Mapped[list[str] | None] = mapped_column(JSONB, default=list)

    # Scoring
    scientific_strength_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    scientific_strength_reasons: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    strategic_relevance_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    strategic_relevance_reasons: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Strategic analysis
    hype_risk: Mapped[str | None] = mapped_column(String(20))
    time_horizon: Mapped[str | None] = mapped_column(String(20))
    recommended_action: Mapped[str | None] = mapped_column(String(20))
    confidence_level: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))

    # Evidence
    facts_from_source: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    extracted_evidence: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    evidence_snippets: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    strategic_interpretation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    # Executive output
    executive_summary_en: Mapped[str | None] = mapped_column(Text)
    executive_summary_es: Mapped[str | None] = mapped_column(Text)
    why_it_matters_en: Mapped[str | None] = mapped_column(Text)
    why_it_matters_es: Mapped[str | None] = mapped_column(Text)
    possible_impact_en: Mapped[str | None] = mapped_column(Text)
    possible_impact_es: Mapped[str | None] = mapped_column(Text)

    # Review
    review_status: Mapped[str] = mapped_column(
        String(15),
        nullable=False,
        default="review",
        server_default="review",
    )
    reviewer_notes: Mapped[str | None] = mapped_column(Text)

    # LLM audit trail
    llm_provider: Mapped[str | None] = mapped_column(String(50))
    llm_model: Mapped[str | None] = mapped_column(String(100))
    llm_prompt_version: Mapped[str | None] = mapped_column(String(50))
    raw_llm_input: Mapped[str | None] = mapped_column(Text)
    raw_llm_output: Mapped[str | None] = mapped_column(Text)

    # Timestamps
    processing_timestamp: Mapped[datetime | None] = mapped_column()

    # Deduplication
    content_hash: Mapped[str | None] = mapped_column(String(64), unique=True)

    __table_args__ = (
        CheckConstraint(
            "document_type IN ('paper', 'review', 'clinical_trial', 'preprint', "
            "'university_publication', 'journal_article', 'strategic_signal')",
            name="chk_document_type",
        ),
        CheckConstraint(
            "hype_risk IS NULL OR hype_risk IN ('low', 'medium', 'high')",
            name="chk_hype_risk",
        ),
        CheckConstraint(
            "time_horizon IS NULL OR time_horizon IN ('immediate', 'short_term', 'medium_term', 'long_term')",
            name="chk_time_horizon",
        ),
        CheckConstraint(
            "recommended_action IS NULL OR recommended_action IN "
            "('monitor', 'investigate', 'test', 'discard')",
            name="chk_recommended_action",
        ),
        CheckConstraint(
            "review_status IN ('relevant', 'review', 'discarded', 'opportunity', 'follow_up')",
            name="chk_review_status",
        ),
        CheckConstraint(
            "confidence_level IS NULL OR (confidence_level >= 0 AND confidence_level <= 1)",
            name="chk_confidence_level",
        ),
        CheckConstraint(
            "scientific_strength_score IS NULL OR "
            "(scientific_strength_score >= 0 AND scientific_strength_score <= 10)",
            name="chk_scientific_strength_score",
        ),
        CheckConstraint(
            "strategic_relevance_score IS NULL OR "
            "(strategic_relevance_score >= 0 AND strategic_relevance_score <= 10)",
            name="chk_strategic_relevance_score",
        ),
    )

    # Relationships
    source: Mapped["Source"] = relationship(  # noqa: F821
        back_populates="research_items",
    )

    def __repr__(self) -> str:
        return f"<ResearchItem(id={self.id}, title='{self.original_title[:50]}...')>"
