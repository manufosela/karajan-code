from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ResearchItemBase(BaseModel):
    """Base schema with common fields for research items."""

    original_title: str
    doi: str | None = None
    pmid: str | None = None
    nct_id: str | None = None
    arxiv_id: str | None = None
    original_url: str | None = None
    normalized_title: str | None = None
    authors: list[dict[str, Any]] = Field(default_factory=list)
    publication_date: date | None = None
    abstract: str | None = None
    journal_or_origin: str | None = None
    document_type: str
    language: str = "en"
    thematic_tags: list[str] = Field(default_factory=list)
    strategic_buckets: list[str] = Field(default_factory=list)


class ResearchItemCreate(ResearchItemBase):
    """Schema for creating a new research item."""

    source_id: UUID
    scientific_strength_score: Decimal | None = Field(default=None, ge=0, le=10)
    scientific_strength_reasons: dict[str, Any] | None = None
    strategic_relevance_score: Decimal | None = Field(default=None, ge=0, le=10)
    strategic_relevance_reasons: dict[str, Any] | None = None
    hype_risk: str | None = Field(default=None, pattern="^(low|medium|high)$")
    time_horizon: str | None = Field(default=None, pattern="^(short|medium|long)$")
    recommended_action: str | None = Field(default=None, pattern="^(monitor|investigate|test|discard)$")
    confidence_level: Decimal | None = Field(default=None, ge=0, le=1)
    facts_from_source: dict[str, Any] | None = None
    extracted_evidence: dict[str, Any] | None = None
    evidence_snippets: dict[str, Any] | None = None
    strategic_interpretation: dict[str, Any] | None = None
    executive_summary_en: str | None = None
    executive_summary_es: str | None = None
    why_it_matters_en: str | None = None
    why_it_matters_es: str | None = None
    possible_impact_en: str | None = None
    possible_impact_es: str | None = None
    review_status: str = "review"
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_prompt_version: str | None = None
    raw_llm_input: str | None = None
    raw_llm_output: str | None = None
    processing_timestamp: datetime | None = None
    content_hash: str | None = None


class ResearchItemUpdate(BaseModel):
    """Schema for partial updates to a research item."""

    review_status: str | None = Field(default=None, pattern="^(relevant|review|discarded|opportunity|follow_up)$")
    thematic_tags: list[str] | None = None
    strategic_buckets: list[str] | None = None
    scientific_strength_score: Decimal | None = Field(default=None, ge=0, le=10)
    strategic_relevance_score: Decimal | None = Field(default=None, ge=0, le=10)
    hype_risk: str | None = Field(default=None, pattern="^(low|medium|high)$")
    time_horizon: str | None = Field(default=None, pattern="^(short|medium|long)$")
    recommended_action: str | None = Field(default=None, pattern="^(monitor|investigate|test|discard)$")
    executive_summary_en: str | None = None
    executive_summary_es: str | None = None


class StatusUpdate(BaseModel):
    """Schema for updating only the review status."""

    review_status: str = Field(..., pattern="^(relevant|review|discarded|opportunity|follow_up)$")


class ResearchItemResponse(BaseModel):
    """Schema for research item list responses (summary view)."""

    id: UUID
    source_id: UUID
    original_title: str
    doi: str | None = None
    publication_date: date | None = None
    document_type: str
    journal_or_origin: str | None = None
    thematic_tags: list[str] = Field(default_factory=list)
    strategic_buckets: list[str] = Field(default_factory=list)
    scientific_strength_score: Decimal | None = None
    strategic_relevance_score: Decimal | None = None
    hype_risk: str | None = None
    time_horizon: str | None = None
    recommended_action: str | None = None
    review_status: str
    executive_summary_en: str | None = None
    executive_summary_es: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResearchItemDetail(BaseModel):
    """Schema for research item detail responses (full view)."""

    id: UUID
    source_id: UUID

    # Identification
    doi: str | None = None
    pmid: str | None = None
    nct_id: str | None = None
    arxiv_id: str | None = None
    original_url: str | None = None

    # Content
    original_title: str
    normalized_title: str | None = None
    authors: list[dict[str, Any]] = Field(default_factory=list)
    publication_date: date | None = None
    abstract: str | None = None
    journal_or_origin: str | None = None
    document_type: str
    language: str | None = None

    # Classification
    thematic_tags: list[str] = Field(default_factory=list)
    strategic_buckets: list[str] = Field(default_factory=list)

    # Scoring
    scientific_strength_score: Decimal | None = None
    scientific_strength_reasons: dict[str, Any] | None = None
    strategic_relevance_score: Decimal | None = None
    strategic_relevance_reasons: dict[str, Any] | None = None

    # Strategic analysis
    hype_risk: str | None = None
    time_horizon: str | None = None
    recommended_action: str | None = None
    confidence_level: Decimal | None = None

    # Evidence
    facts_from_source: dict[str, Any] | None = None
    extracted_evidence: dict[str, Any] | None = None
    evidence_snippets: dict[str, Any] | None = None
    strategic_interpretation: dict[str, Any] | None = None

    # Executive output
    executive_summary_en: str | None = None
    executive_summary_es: str | None = None
    why_it_matters_en: str | None = None
    why_it_matters_es: str | None = None
    possible_impact_en: str | None = None
    possible_impact_es: str | None = None

    # Review
    review_status: str
    reviewer_notes: str | None = None

    # LLM audit trail
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_prompt_version: str | None = None
    raw_llm_input: str | None = None
    raw_llm_output: str | None = None

    # Timestamps
    processing_timestamp: datetime | None = None
    content_hash: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResearchItemStats(BaseModel):
    """Aggregated statistics about research items."""

    total_count: int
    by_status: dict[str, int]
    by_source: dict[str, int]
    by_bucket: dict[str, int]
    by_document_type: dict[str, int]
    avg_scientific_score: float | None = None
    avg_strategic_score: float | None = None
