import json
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SourceBase(BaseModel):
    """Base schema for sources."""

    name: str
    source_type: str
    category: str
    priority: int = Field(default=5, ge=1, le=10)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    base_url: str | None = None


class SourceResponse(BaseModel):
    """Schema for source responses."""

    id: UUID
    name: str
    source_type: str
    category: str
    priority: int
    enabled: bool
    config: dict[str, Any] = Field(default_factory=dict)
    base_url: str | None = None
    last_fetched_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("config", mode="before")
    @classmethod
    def parse_config(cls, v: Any) -> dict[str, Any]:
        if isinstance(v, str):
            parsed: dict[str, Any] = json.loads(v)
            return parsed
        return v or {}

    model_config = {"from_attributes": True}


class SourceDetailResponse(SourceResponse):
    """Schema for source detail with last ingestion stats."""

    last_run_status: str | None = None
    last_run_at: datetime | None = None
    items_fetched_last_run: int | None = None
    total_runs: int = 0


class IngestionRunResponse(BaseModel):
    """Schema for ingestion run responses."""

    id: UUID
    source_id: UUID
    started_at: datetime
    completed_at: datetime | None = None
    status: str
    items_fetched: int
    items_new: int
    items_duplicate: int
    items_processed: int
    errors: list[dict[str, Any]] | None = None

    model_config = {"from_attributes": True}


class SourceUpdate(BaseModel):
    """Schema for partial source updates.

    query_terms and max_results are convenience fields that get
    merged into the config JSONB field.
    """

    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=10)
    config: dict[str, Any] | None = None
    base_url: str | None = None
    query_terms: list[str] | None = None
    max_results: int | None = Field(default=None, ge=1)
