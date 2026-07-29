from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db, require_admin
from app.models.ingestion_run import IngestionRun
from app.models.source import Source
from app.models.user import User
from app.schemas.source import (
    IngestionRunResponse,
    SourceDetailResponse,
    SourceResponse,
    SourceUpdate,
)

router = APIRouter()


@router.get("", response_model=list[SourceResponse])
async def list_sources(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[SourceResponse]:
    """List all configured research sources."""
    result = await db.execute(select(Source).order_by(Source.priority.asc(), Source.name.asc()))
    sources = result.scalars().all()
    return [SourceResponse.model_validate(s) for s in sources]


@router.get("/{source_id}", response_model=SourceDetailResponse)
async def get_source_detail(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> SourceDetailResponse:
    """Get source detail with last ingestion stats."""
    result = await db.execute(
        select(Source).where(Source.id == source_id).options(selectinload(Source.ingestion_runs))
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail=f"Source {source_id} not found")

    runs = source.ingestion_runs or []
    sorted_runs = sorted(runs, key=lambda r: r.started_at, reverse=True)

    last_run = sorted_runs[0] if sorted_runs else None

    data = SourceResponse.model_validate(source).model_dump()
    data["last_run_status"] = last_run.status if last_run else None
    data["last_run_at"] = last_run.started_at if last_run else None
    data["items_fetched_last_run"] = last_run.items_fetched if last_run else None
    data["total_runs"] = len(runs)

    return SourceDetailResponse(**data)


@router.patch("/{source_id}", response_model=SourceResponse)
async def update_source(
    source_id: UUID,
    body: SourceUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> SourceResponse:
    """Update a source (enable/disable, config, priority, base_url, query_terms, max_results)."""
    result = await db.execute(select(Source).where(Source.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail=f"Source {source_id} not found")

    update_data = body.model_dump(exclude_unset=True)

    # Merge query_terms and max_results into config JSONB
    config_extras: dict = {}
    if "query_terms" in update_data:
        config_extras["query_terms"] = update_data.pop("query_terms")
    if "max_results" in update_data:
        config_extras["max_results"] = update_data.pop("max_results")

    if config_extras:
        current_config = dict(source.config or {})
        if "config" in update_data:
            current_config.update(update_data.pop("config"))
        current_config.update(config_extras)
        update_data["config"] = current_config

    for field, value in update_data.items():
        setattr(source, field, value)

    db.add(source)
    await db.flush()
    await db.refresh(source)
    return SourceResponse.model_validate(source)


@router.get("/{source_id}/runs", response_model=list[IngestionRunResponse])
async def list_source_runs(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[IngestionRunResponse]:
    """List ingestion runs for a source, ordered by started_at descending."""
    source_result = await db.execute(select(Source).where(Source.id == source_id))
    if source_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Source {source_id} not found")

    result = await db.execute(
        select(IngestionRun)
        .where(IngestionRun.source_id == source_id)
        .order_by(IngestionRun.started_at.desc())
    )
    runs = result.scalars().all()
    return [IngestionRunResponse.model_validate(r) for r in runs]
