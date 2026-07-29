import math
from datetime import datetime
from typing import TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Pagination parameters for list endpoints."""

    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page (max 100)")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class PaginatedResponse[T](BaseModel):
    """Generic paginated response wrapper."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int

    @classmethod
    def create(cls, items: list[T], total: int, page: int, page_size: int) -> "PaginatedResponse[T]":
        pages = max(1, math.ceil(total / page_size))
        return cls(items=items, total=total, page=page, page_size=page_size, pages=pages)


class ErrorDetail(BaseModel):
    """Structured error detail."""

    code: str
    message: str
    request_id: str | None = None


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: ErrorDetail


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    version: str
    database: str = "ok"
    timestamp: datetime


class ReadyResponse(BaseModel):
    """Readiness check response."""

    ready: bool
    checks: dict[str, bool]
    request_id: UUID | None = None
