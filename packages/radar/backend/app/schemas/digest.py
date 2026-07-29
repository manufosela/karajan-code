"""Pydantic schemas for digest endpoints."""

from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class DeliveryChannelEnum(str, Enum):
    """Valid delivery channels."""

    teams = "teams"
    email = "email"


class DeliveryStatusEnum(str, Enum):
    """Valid delivery statuses."""

    pending = "pending"
    sent = "sent"
    failed = "failed"


class DigestTriggerRequest(BaseModel):
    """Request body for triggering digest generation."""

    deliver: bool = Field(default=False, description="Whether to deliver the digest after generation")
    channel: DeliveryChannelEnum = Field(
        default=DeliveryChannelEnum.teams, description="Delivery channel"
    )


class DigestItemSummary(BaseModel):
    """Summary of a research item included in a digest."""

    id: str
    title: str
    score: float
    summary: str | None = None
    recommended_action: str | None = None


class DigestResponse(BaseModel):
    """Schema for digest list responses."""

    id: UUID
    digest_date: date
    items_included: list[str]
    delivery_channel: str
    delivery_status: str
    sent_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DigestDetailResponse(BaseModel):
    """Schema for digest detail response including payload."""

    id: UUID
    digest_date: date
    items_included: list[str]
    delivery_channel: str
    delivery_status: str
    payload: dict[str, Any] | None = None
    sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DigestListPaginatedResponse(BaseModel):
    """Paginated response for digest listing."""

    items: list[DigestResponse]
    total: int
    offset: int
    limit: int


class DigestTriggerResponse(BaseModel):
    """Response after triggering digest generation."""

    digest_id: UUID
    digest_date: date
    items_count: int
    delivery_status: str
    message: str
