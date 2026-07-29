"""Dashboard response schemas."""

from datetime import datetime

from pydantic import BaseModel


class AvgScores(BaseModel):
    """Average scientific and strategic scores."""

    scientific: float | None = None
    strategic: float | None = None


class RecentActivityItem(BaseModel):
    """Summary of a recently created/updated research item."""

    id: str
    title: str
    status: str
    created_at: datetime


class DashboardStats(BaseModel):
    """Aggregated statistics for the dashboard."""

    total_signals: int
    signals_by_status: dict[str, int]
    signals_by_theme: dict[str, int]
    signals_by_bucket: dict[str, int]
    avg_scores: AvgScores
    recent_activity: list[RecentActivityItem]
