"""Schemas for signal (research item) CRUD endpoints."""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class SortByEnum(str, Enum):
    """Allowed sort fields for signal list."""

    date = "date"
    score = "score"
    relevance = "relevance"
    created_at = "created_at"


class SortOrderEnum(str, Enum):
    """Sort direction."""

    asc = "asc"
    desc = "desc"


class SignalListResponse(BaseModel):
    """Summary view of a signal for list endpoints."""

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
    reviewer_notes: str | None = None
    executive_summary_en: str | None = None
    executive_summary_es: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SignalDetailResponse(BaseModel):
    """Full detail view of a signal."""

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
    possible_impact_for_geniova_en: str | None = None
    possible_impact_for_geniova_es: str | None = None

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


class ReviewUpdate(BaseModel):
    """Schema for updating review status and notes."""

    review_status: str = Field(..., pattern="^(relevant|review|discarded|opportunity|follow_up)$")
    reviewer_notes: str | None = None


class SignalReviewResponse(BaseModel):
    """Response after a review update."""

    id: UUID
    review_status: str
    reviewer_notes: str | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class SignalListPaginatedResponse(BaseModel):
    """Paginated response for signal list with offset/limit."""

    items: list[SignalListResponse]
    total: int
    offset: int
    limit: int
