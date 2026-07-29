from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, asc, cast, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.schemas.research_item import ResearchItemStats
from app.schemas.signals import (
    ReviewUpdate,
    SignalDetailResponse,
    SignalListPaginatedResponse,
    SignalListResponse,
    SignalReviewResponse,
    SortByEnum,
    SortOrderEnum,
)

router = APIRouter()

# Mapping from sort_by enum to model columns
_SORT_COLUMNS = {
    SortByEnum.date: ResearchItem.publication_date,
    SortByEnum.score: ResearchItem.strategic_relevance_score,
    SortByEnum.relevance: ResearchItem.scientific_strength_score,
    SortByEnum.created_at: ResearchItem.created_at,
}


def _jsonb_contains(column, value: str, db: AsyncSession):
    """JSONB array contains check — works on both PostgreSQL (@>) and SQLite (LIKE on text)."""
    bind = db.bind
    if bind and bind.dialect.name == "sqlite":
        return cast(column, String).like(f'%"{value}"%')
    return column.op("@>")(f'["{value}"]')


@router.get("", response_model=SignalListPaginatedResponse)
async def list_signals(
    offset: int = Query(default=0, ge=0, description="Number of items to skip"),
    limit: int = Query(default=20, ge=1, le=100, description="Number of items to return"),
    sort_by: SortByEnum = Query(default=SortByEnum.created_at, description="Sort field"),
    sort_order: SortOrderEnum = Query(default=SortOrderEnum.desc, description="Sort direction"),
    date_from: date | None = Query(default=None, description="Filter by publication date (from)"),
    date_to: date | None = Query(default=None, description="Filter by publication date (to)"),
    source_id: UUID | None = Query(default=None, description="Filter by source ID"),
    document_type: str | None = Query(default=None, description="Filter by document type"),
    theme: str | None = Query(default=None, description="Filter by thematic tag"),
    bucket: str | None = Query(default=None, description="Filter by strategic bucket"),
    review_status: str | None = Query(default=None, description="Filter by review status"),
    hype_risk: str | None = Query(default=None, description="Filter by hype risk level"),
    recommended_action: str | None = Query(default=None, description="Filter by recommended action"),
    min_strategic_score: Decimal | None = Query(
        default=None, ge=0, le=10, description="Min strategic relevance score"
    ),
    min_scientific_score: Decimal | None = Query(
        default=None, ge=0, le=10, description="Min scientific strength score"
    ),
    search: str | None = Query(default=None, description="Text search on title"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> SignalListPaginatedResponse:
    """List research items (signals) with filtering, sorting, and offset/limit pagination."""
    query = select(ResearchItem)

    # Filters
    if date_from is not None:
        query = query.where(ResearchItem.publication_date >= date_from)
    if date_to is not None:
        query = query.where(ResearchItem.publication_date <= date_to)
    if source_id is not None:
        query = query.where(ResearchItem.source_id == source_id)
    if document_type is not None:
        query = query.where(ResearchItem.document_type == document_type)
    if theme is not None:
        query = query.where(_jsonb_contains(ResearchItem.thematic_tags, theme, db))
    if bucket is not None:
        query = query.where(_jsonb_contains(ResearchItem.strategic_buckets, bucket, db))
    if review_status is not None:
        query = query.where(ResearchItem.review_status == review_status)
    if hype_risk is not None:
        query = query.where(ResearchItem.hype_risk == hype_risk)
    if recommended_action is not None:
        query = query.where(ResearchItem.recommended_action == recommended_action)
    if min_strategic_score is not None:
        query = query.where(ResearchItem.strategic_relevance_score >= min_strategic_score)
    if min_scientific_score is not None:
        query = query.where(ResearchItem.scientific_strength_score >= min_scientific_score)
    if search is not None:
        search_pattern = f"%{search}%"
        query = query.where(func.lower(ResearchItem.original_title).like(func.lower(search_pattern)))

    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Sorting
    sort_col = _SORT_COLUMNS[sort_by]
    order_fn = asc if sort_order == SortOrderEnum.asc else desc
    query = query.order_by(order_fn(sort_col))

    # Pagination
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    return SignalListPaginatedResponse(
        items=[SignalListResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/stats", response_model=ResearchItemStats)
async def get_signal_stats(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> ResearchItemStats:
    """Get aggregated statistics about research items."""
    total_result = await db.execute(select(func.count(ResearchItem.id)))
    total_count = total_result.scalar_one()

    # Count by review status
    status_query = select(
        ResearchItem.review_status,
        func.count(ResearchItem.id),
    ).group_by(ResearchItem.review_status)
    status_result = await db.execute(status_query)
    by_status = {row[0]: row[1] for row in status_result.all()}

    # Count by source (using source name)
    source_query = (
        select(Source.name, func.count(ResearchItem.id))
        .join(Source, ResearchItem.source_id == Source.id)
        .group_by(Source.name)
    )
    source_result = await db.execute(source_query)
    by_source = {row[0]: row[1] for row in source_result.all()}

    # Count by document type
    doctype_query = select(
        ResearchItem.document_type,
        func.count(ResearchItem.id),
    ).group_by(ResearchItem.document_type)
    doctype_result = await db.execute(doctype_query)
    by_document_type = {row[0]: row[1] for row in doctype_result.all()}

    # Count by strategic bucket (unnest JSONB array)
    by_bucket: dict[str, int] = {}
    bucket_items_query = select(ResearchItem.strategic_buckets).where(
        ResearchItem.strategic_buckets.isnot(None)
    )
    bucket_items_result = await db.execute(bucket_items_query)
    for (buckets,) in bucket_items_result.all():
        if isinstance(buckets, list):
            for b in buckets:
                by_bucket[b] = by_bucket.get(b, 0) + 1

    # Average scores
    avg_query = select(
        func.avg(ResearchItem.scientific_strength_score),
        func.avg(ResearchItem.strategic_relevance_score),
    )
    avg_result = await db.execute(avg_query)
    avg_row = avg_result.one()
    avg_scientific = float(avg_row[0]) if avg_row[0] is not None else None
    avg_strategic = float(avg_row[1]) if avg_row[1] is not None else None

    return ResearchItemStats(
        total_count=total_count,
        by_status=by_status,
        by_source=by_source,
        by_bucket=by_bucket,
        by_document_type=by_document_type,
        avg_scientific_score=avg_scientific,
        avg_strategic_score=avg_strategic,
    )


@router.get("/{signal_id}", response_model=SignalDetailResponse)
async def get_signal(
    signal_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> SignalDetailResponse:
    """Get full details of a specific research item."""
    result = await db.execute(select(ResearchItem).where(ResearchItem.id == signal_id))
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail=f"Signal {signal_id} not found")
    return SignalDetailResponse.model_validate(item)


@router.patch("/{signal_id}/review", response_model=SignalReviewResponse)
async def update_signal_review(
    signal_id: UUID,
    body: ReviewUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> SignalReviewResponse:
    """Update the review status and reviewer notes of a research item."""
    result = await db.execute(select(ResearchItem).where(ResearchItem.id == signal_id))
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail=f"Signal {signal_id} not found")

    item.review_status = body.review_status
    if body.reviewer_notes is not None:
        item.reviewer_notes = body.reviewer_notes
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return SignalReviewResponse.model_validate(item)
