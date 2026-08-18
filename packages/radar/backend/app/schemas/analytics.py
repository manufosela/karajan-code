"""Schemas for analytics endpoints."""

from datetime import datetime

from pydantic import BaseModel, Field


class TimeSeriesPoint(BaseModel):
    """A single data point in a time series."""

    date: str  # YYYY-MM-DD
    count: int


class TrendsBySource(BaseModel):
    """Time series data grouped by source."""

    source_id: str
    source_name: str
    data: list[TimeSeriesPoint]


class TrendsResponse(BaseModel):
    """Response for the trends endpoint."""

    period: str
    total: int
    by_source: list[TrendsBySource]


class ScoreDistribution(BaseModel):
    """A single bucket in a score histogram."""

    bucket: str  # "0-1", "1-2", ..., "9-10"
    count: int


class ScoresResponse(BaseModel):
    """Response for the scores endpoint with distributions and aggregations."""

    scientific: list[ScoreDistribution]
    strategic: list[ScoreDistribution]
    avg_scientific: float | None = None
    avg_strategic: float | None = None
    by_bucket: dict[str, int] = Field(default_factory=dict)
    by_hype_risk: dict[str, int] = Field(default_factory=dict)
    by_recommended_action: dict[str, int] = Field(default_factory=dict)


class IngestionRunSummary(BaseModel):
    """Summary of a single ingestion run."""

    id: str
    source_name: str
    started_at: datetime
    status: str
    items_fetched: int
    items_new: int
    items_duplicate: int
    duration_seconds: float | None = None


class SourceHealth(BaseModel):
    """Health information for a single source."""

    source_name: str
    last_fetched_at: datetime | None = None
    runs_7d: int = 0
    error_rate: float = 0.0


class IngestionHealthResponse(BaseModel):
    """Response for the ingestion health endpoint."""

    recent_runs: list[IngestionRunSummary]
    sources_health: list[SourceHealth]
    total_processed_24h: int
    total_errors_24h: int


class CostLineItem(BaseModel):
    """A single line item in the cost estimate breakdown."""

    label: str
    amount: float = Field(ge=0, description="Estimated cost in USD")
    note: str | None = None


class CostEstimateResponse(BaseModel):
    """Response for the cost estimate endpoint."""

    period: str = Field(description="Period covered, e.g. 'current_month'")
    line_items: list[CostLineItem]
    total_estimated: float = Field(ge=0, description="Total estimated cost in USD")
    currency: str = "USD"
    signals_processed: int = Field(ge=0, description="Number of signals processed via LLM this period")
    ingestion_runs: int = Field(ge=0, description="Number of ingestion runs this period")
    last_updated: datetime
