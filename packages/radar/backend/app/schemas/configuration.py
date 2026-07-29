import json
from datetime import datetime
from enum import Enum, StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator


class ConfigCategoryEnum(StrEnum):
    """Valid configuration categories."""

    thematic = "thematic"
    scoring = "scoring"
    delivery = "delivery"
    llm = "llm"
    general = "general"
    sources = "sources"


class ConfigResponse(BaseModel):
    """Schema for configuration responses."""

    id: UUID
    category: str
    key: str
    value: dict[str, Any]
    description: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("value", mode="before")
    @classmethod
    def parse_value(cls, v: Any) -> dict[str, Any]:
        if isinstance(v, str):
            parsed: dict[str, Any] = json.loads(v)
            return parsed
        return v or {}

    model_config = {"from_attributes": True}


class ConfigUpdate(BaseModel):
    """Schema for updating a configuration value."""

    value: dict[str, Any]
    description: str | None = None


class TopicTaxonomyResponse(BaseModel):
    """Schema for topic taxonomy response (thematic config)."""

    orthodontics_keywords: dict[str, Any] | None = None
    strategic_buckets: dict[str, Any] | None = None


class ScoringWeightsUpdate(BaseModel):
    """Schema for updating scoring weights with validation."""

    weights: dict[str, float]

    @model_validator(mode="after")
    def validate_required_weight_keys(self) -> "ScoringWeightsUpdate":
        required_keys = {"novelty", "relevance", "impact", "credibility"}
        missing = required_keys - set(self.weights.keys())
        if missing:
            msg = f"Missing required weight keys: {', '.join(sorted(missing))}"
            raise ValueError(msg)
        return self


class DeliverySettingsResponse(BaseModel):
    """Schema for aggregated delivery settings response."""

    digest_frequency: dict[str, Any] | None = None
    channels: dict[str, Any] | None = None
    recipients: dict[str, Any] | None = None


# --- Schedule schemas ---

ScheduleTypeEnum = Enum(
    "ScheduleTypeEnum",
    {"daily": "daily", "weekly": "weekly", "monthly": "monthly", "custom": "custom"},
    type=str,
)

VALID_DAYS_OF_WEEK = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


class ScheduleResponse(BaseModel):
    """Schema for ingestion schedule GET response."""

    schedule_type: str
    time: str
    timezone: str
    days_of_week: list[str]
    day_of_month: int | None = None
    custom_cron: str | None = None
    cron_expression: str
    description: str
    next_runs: list[str]
    sync_status: str = "local_only"
    sync_error: str | None = None


class ScheduleUpdate(BaseModel):
    """Schema for updating the ingestion schedule."""

    schedule_type: str
    time: str
    timezone: str = "Europe/Madrid"
    days_of_week: list[str] = []
    day_of_month: int | None = None
    custom_cron: str | None = None

    @model_validator(mode="after")
    def validate_schedule(self) -> "ScheduleUpdate":
        """Validate schedule fields based on schedule_type."""
        valid_types = {"daily", "weekly", "monthly", "custom"}
        if self.schedule_type not in valid_types:
            msg = f"schedule_type must be one of {valid_types}, got '{self.schedule_type}'"
            raise ValueError(msg)

        # Validate time format
        parts = self.time.split(":")
        if len(parts) != 2:
            raise ValueError(f"Invalid time format '{self.time}', expected HH:MM")
        try:
            hour, minute = int(parts[0]), int(parts[1])
        except ValueError as exc:
            raise ValueError(f"Invalid time format '{self.time}', expected numeric HH:MM") from exc
        if not (0 <= hour <= 23) or not (0 <= minute <= 59):
            raise ValueError(f"Invalid time '{self.time}': hour 0-23, minute 0-59")

        if self.schedule_type == "weekly":
            if not self.days_of_week:
                raise ValueError("days_of_week is required for weekly schedule")
            invalid = set(self.days_of_week) - VALID_DAYS_OF_WEEK
            if invalid:
                raise ValueError(f"Invalid days: {', '.join(sorted(invalid))}")

        if self.schedule_type == "monthly":
            if self.day_of_month is None:
                raise ValueError("day_of_month is required for monthly schedule")
            if not (1 <= self.day_of_month <= 28):
                raise ValueError("day_of_month must be between 1 and 28")

        if self.schedule_type == "custom" and (not self.custom_cron or not self.custom_cron.strip()):
            raise ValueError("custom_cron is required for custom schedule")

        return self


class RunNowResponse(BaseModel):
    """Schema for the run-now endpoint response."""

    message: str
    status: str
