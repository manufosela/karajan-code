"""Dashboard endpoints — aggregate statistics for the main dashboard."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.research_item import ResearchItem
from app.schemas.dashboard import (
    AvgScores,
    DashboardStats,
    RecentActivityItem,
)

router = APIRouter()


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> DashboardStats:
    """Return aggregate statistics for the dashboard."""
    # Total signals
    total_result = await db.execute(select(func.count(ResearchItem.id)))
    total_signals = total_result.scalar_one()

    # Count by review status
    status_query = select(
        ResearchItem.review_status,
        func.count(ResearchItem.id),
    ).group_by(ResearchItem.review_status)
    status_result = await db.execute(status_query)
    signals_by_status = {row[0]: row[1] for row in status_result.all()}

    # Count by thematic tag (unnest JSONB array in Python)
    signals_by_theme: dict[str, int] = {}
    tags_query = select(ResearchItem.thematic_tags).where(
        ResearchItem.thematic_tags.isnot(None)
    )
    tags_result = await db.execute(tags_query)
    for (tags,) in tags_result.all():
        if isinstance(tags, list):
            for tag in tags:
                signals_by_theme[tag] = signals_by_theme.get(tag, 0) + 1

    # Count by strategic bucket (unnest JSONB array in Python)
    signals_by_bucket: dict[str, int] = {}
    buckets_query = select(ResearchItem.strategic_buckets).where(
        ResearchItem.strategic_buckets.isnot(None)
    )
    buckets_result = await db.execute(buckets_query)
    for (buckets,) in buckets_result.all():
        if isinstance(buckets, list):
            for b in buckets:
                signals_by_bucket[b] = signals_by_bucket.get(b, 0) + 1

    # Average scores
    avg_query = select(
        func.avg(ResearchItem.scientific_strength_score),
        func.avg(ResearchItem.strategic_relevance_score),
    )
    avg_result = await db.execute(avg_query)
    avg_row = avg_result.one()
    avg_scientific = float(avg_row[0]) if avg_row[0] is not None else None
    avg_strategic = float(avg_row[1]) if avg_row[1] is not None else None

    # Recent activity — last 10 items by created_at
    recent_query = (
        select(ResearchItem)
        .order_by(ResearchItem.created_at.desc())
        .limit(10)
    )
    recent_result = await db.execute(recent_query)
    recent_items = recent_result.scalars().all()
    recent_activity = [
        RecentActivityItem(
            id=str(item.id),
            title=item.original_title,
            status=item.review_status,
            created_at=item.created_at,
        )
        for item in recent_items
    ]

    return DashboardStats(
        total_signals=total_signals,
        signals_by_status=signals_by_status,
        signals_by_theme=signals_by_theme,
        signals_by_bucket=signals_by_bucket,
        avg_scores=AvgScores(
            scientific=avg_scientific,
            strategic=avg_strategic,
        ),
        recent_activity=recent_activity,
    )
