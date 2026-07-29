"""API endpoints for digest management."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_settings, require_admin
from app.core.config import Settings
from app.models.daily_digest import DailyDigest
from app.schemas.digest import (
    DigestDetailResponse,
    DigestListPaginatedResponse,
    DigestResponse,
    DigestTriggerRequest,
    DigestTriggerResponse,
)
from app.services.digest import DigestService
from app.services.teams_webhook import TeamsWebhookService

router = APIRouter()


@router.get("", response_model=DigestListPaginatedResponse)
async def list_digests(
    offset: int = Query(default=0, ge=0, description="Number of items to skip"),
    limit: int = Query(default=20, ge=1, le=100, description="Number of items to return"),
    date_from: date | None = Query(default=None, description="Filter by digest date (from)"),
    date_to: date | None = Query(default=None, description="Filter by digest date (to)"),
    delivery_status: str | None = Query(default=None, description="Filter by delivery status"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> DigestListPaginatedResponse:
    """List recent digests with optional filtering and pagination."""
    query = select(DailyDigest)

    if date_from is not None:
        query = query.where(DailyDigest.digest_date >= date_from)
    if date_to is not None:
        query = query.where(DailyDigest.digest_date <= date_to)
    if delivery_status is not None:
        query = query.where(DailyDigest.delivery_status == delivery_status)

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = query.order_by(desc(DailyDigest.created_at)).offset(offset).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    return DigestListPaginatedResponse(
        items=[DigestResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{digest_id}", response_model=DigestDetailResponse)
async def get_digest(
    digest_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> DigestDetailResponse:
    """Get full details of a specific digest."""
    result = await db.execute(select(DailyDigest).where(DailyDigest.id == digest_id))
    digest = result.scalar_one_or_none()
    if digest is None:
        raise HTTPException(status_code=404, detail=f"Digest {digest_id} not found")
    return DigestDetailResponse.model_validate(digest)


@router.post("/trigger", response_model=DigestTriggerResponse)
async def trigger_digest(
    body: DigestTriggerRequest | None = None,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _user=Depends(require_admin),
) -> DigestTriggerResponse:
    """Manually trigger digest generation (admin only)."""
    if body is None:
        body = DigestTriggerRequest()

    webhook = TeamsWebhookService(webhook_url=settings.TEAMS_WEBHOOK_URL)
    service = DigestService(teams_webhook=webhook)

    digest = await service.trigger(
        db,
        channel=body.channel.value,
        deliver=body.deliver,
    )

    if digest is None:
        return DigestTriggerResponse(
            digest_id=UUID("00000000-0000-0000-0000-000000000000"),
            digest_date=date.today(),
            items_count=0,
            delivery_status="no_content",
            message="No signals above relevance threshold — no digest generated",
        )

    return DigestTriggerResponse(
        digest_id=digest.id,
        digest_date=digest.digest_date,
        items_count=len(digest.items_included),
        delivery_status=digest.delivery_status,
        message=f"Digest generated with {len(digest.items_included)} items",
    )
