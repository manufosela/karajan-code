import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_admin
from app.core.config import settings
from app.models.configuration import Configuration
from app.models.user import User
from app.schemas.configuration import (
    ConfigCategoryEnum,
    ConfigResponse,
    ConfigUpdate,
    DeliverySettingsResponse,
    RunNowResponse,
    ScheduleResponse,
    ScheduleUpdate,
    ScoringWeightsUpdate,
    TopicTaxonomyResponse,
)
from app.utils.cron import (
    calculate_next_runs,
    describe_schedule,
    generate_cron,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _sync_cloud_scheduler(cron_expression: str, timezone: str) -> tuple[str, str | None]:
    """Update Cloud Scheduler job.

    Returns:
        A tuple of (sync_status, sync_error).
        sync_status is "synced", "pending_sync", or "local_only".
        sync_error is None on success, or an error message on failure.
    """
    if not settings.SCHEDULER_JOB_NAME:
        logger.info("SCHEDULER_JOB_NAME not configured; skipping Cloud Scheduler sync")
        return "local_only", None

    try:
        from google.cloud import scheduler_v1
    except ImportError:
        logger.info("google-cloud-scheduler not installed; skipping Cloud Scheduler sync")
        return "local_only", None

    try:
        client = scheduler_v1.CloudSchedulerClient()
        job_name = settings.SCHEDULER_JOB_NAME
        job = scheduler_v1.Job(
            name=job_name,
            schedule=cron_expression,
            time_zone=timezone,
        )
        update_mask = {"paths": ["schedule", "time_zone"]}
        client.update_job(job=job, update_mask=update_mask)
        logger.info("Cloud Scheduler job updated: schedule=%s, timezone=%s", cron_expression, timezone)
        return "synced", None
    except Exception as e:
        error_msg = str(e)
        logger.warning("Failed to sync Cloud Scheduler: %s", error_msg)
        return "pending_sync", error_msg


@router.get("", response_model=list[ConfigResponse])
async def list_configuration(
    category: str | None = Query(default=None, description="Filter by configuration category"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[ConfigResponse]:
    """List all configuration entries, optionally filtered by category."""
    query = select(Configuration).order_by(Configuration.category, Configuration.key)
    if category is not None:
        query = query.where(Configuration.category == category)

    result = await db.execute(query)
    configs = result.scalars().all()
    return [ConfigResponse.model_validate(c) for c in configs]


# --- Static routes MUST be defined BEFORE parameterized routes ---


@router.get("/thematic/topics", response_model=TopicTaxonomyResponse)
async def get_thematic_topics(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> TopicTaxonomyResponse:
    """Get topic taxonomy: orthodontics keywords and strategic buckets."""
    result = await db.execute(
        select(Configuration).where(
            Configuration.category == "thematic",
            Configuration.key.in_(["orthodontics_keywords", "strategic_buckets"]),
        )
    )
    configs = result.scalars().all()
    if not configs:
        raise HTTPException(status_code=404, detail="No thematic topic configuration found")

    data: dict = {}
    for config in configs:
        data[config.key] = config.value

    return TopicTaxonomyResponse(**data)


@router.get("/delivery", response_model=DeliverySettingsResponse)
async def get_delivery_settings(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> DeliverySettingsResponse:
    """Get delivery settings: digest frequency, channels, and recipients."""
    result = await db.execute(select(Configuration).where(Configuration.category == "delivery"))
    configs = result.scalars().all()
    if not configs:
        raise HTTPException(status_code=404, detail="No delivery configuration found")

    data: dict = {}
    for config in configs:
        data[config.key] = config.value

    return DeliverySettingsResponse(**data)


@router.put("/scoring/weights", response_model=ConfigResponse)
async def update_scoring_weights(
    body: ScoringWeightsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ConfigResponse:
    """Update scoring weight configuration with domain validation."""
    result = await db.execute(
        select(Configuration).where(
            Configuration.category == "scoring",
            Configuration.key == "weights",
        )
    )
    config = result.scalar_one_or_none()

    value = {"weights": body.weights}
    if config is None:
        config = Configuration(
            category="scoring",
            key="weights",
            value=value,
            description="Scoring weight factors",
        )
        db.add(config)
    else:
        config.value = value
        db.add(config)

    await db.flush()
    await db.refresh(config)
    return ConfigResponse.model_validate(config)


# --- Schedule routes ---

DEFAULT_SCHEDULE = {
    "schedule_type": "daily",
    "time": "07:00",
    "timezone": "Europe/Madrid",
    "days_of_week": [],
    "day_of_month": None,
    "custom_cron": None,
}


async def _get_schedule_config(db: AsyncSession) -> dict:
    """Retrieve the ingestion schedule from the configuration table."""
    result = await db.execute(
        select(Configuration).where(
            Configuration.category == "sources",
            Configuration.key == "ingestion_schedule",
        )
    )
    config = result.scalar_one_or_none()
    if config is None or not config.value:
        return dict(DEFAULT_SCHEDULE)
    return {**DEFAULT_SCHEDULE, **config.value}


@router.get("/schedule", response_model=ScheduleResponse)
async def get_schedule(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ScheduleResponse:
    """Get the current ingestion schedule configuration."""
    data = await _get_schedule_config(db)

    cron_expr = generate_cron(
        schedule_type=data["schedule_type"],
        time=data["time"],
        days_of_week=data.get("days_of_week"),
        day_of_month=data.get("day_of_month"),
        custom_cron=data.get("custom_cron"),
    )

    next_runs = calculate_next_runs(
        schedule_type=data["schedule_type"],
        time=data["time"],
        timezone=data["timezone"],
        days_of_week=data.get("days_of_week"),
        day_of_month=data.get("day_of_month"),
        count=3,
    )

    return ScheduleResponse(
        schedule_type=data["schedule_type"],
        time=data["time"],
        timezone=data["timezone"],
        days_of_week=data.get("days_of_week") or [],
        day_of_month=data.get("day_of_month"),
        custom_cron=data.get("custom_cron"),
        cron_expression=cron_expr,
        description=describe_schedule(
            data["schedule_type"],
            data["time"],
            data.get("days_of_week"),
            data.get("day_of_month"),
        ),
        next_runs=next_runs,
    )


@router.put("/schedule", response_model=ScheduleResponse)
async def update_schedule(
    body: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ScheduleResponse:
    """Update the ingestion schedule configuration. Admin only.

    After saving to DB, automatically syncs the schedule to Cloud
    Scheduler. If the sync fails, the DB change is preserved and a
    warning is returned via sync_status/sync_error.
    """
    cron_expr = generate_cron(
        schedule_type=body.schedule_type,
        time=body.time,
        days_of_week=body.days_of_week or None,
        day_of_month=body.day_of_month,
        custom_cron=body.custom_cron,
    )

    schedule_value = {
        "schedule_type": body.schedule_type,
        "time": body.time,
        "timezone": body.timezone,
        "days_of_week": body.days_of_week,
        "day_of_month": body.day_of_month,
        "custom_cron": body.custom_cron,
    }

    result = await db.execute(
        select(Configuration).where(
            Configuration.category == "sources",
            Configuration.key == "ingestion_schedule",
        )
    )
    config = result.scalar_one_or_none()

    if config is None:
        config = Configuration(
            category="sources",
            key="ingestion_schedule",
            value=schedule_value,
            description="Ingestion schedule configuration",
        )
        db.add(config)
    else:
        config.value = schedule_value
        db.add(config)

    await db.flush()

    next_runs = calculate_next_runs(
        schedule_type=body.schedule_type,
        time=body.time,
        timezone=body.timezone,
        days_of_week=body.days_of_week or None,
        day_of_month=body.day_of_month,
        count=3,
    )

    sync_status, sync_error = await _sync_cloud_scheduler(cron_expr, body.timezone)

    return ScheduleResponse(
        schedule_type=body.schedule_type,
        time=body.time,
        timezone=body.timezone,
        days_of_week=body.days_of_week,
        day_of_month=body.day_of_month,
        custom_cron=body.custom_cron,
        cron_expression=cron_expr,
        description=describe_schedule(
            body.schedule_type,
            body.time,
            body.days_of_week or None,
            body.day_of_month,
        ),
        next_runs=next_runs,
        sync_status=sync_status,
        sync_error=sync_error,
    )


async def _run_ingestion_background() -> None:
    """Background task that runs the ingestion pipeline.

    This is a placeholder; the real implementation would import and call
    the actual ingestion service.
    """
    logger.info("Manual ingestion triggered via run-now endpoint")
    # TODO: Import and call actual ingestion pipeline
    # from app.jobs.ingestion import run_full_ingestion
    # await run_full_ingestion()
    logger.info("Manual ingestion background task completed")


@router.post("/schedule/run-now", response_model=RunNowResponse)
async def run_ingestion_now(
    background_tasks: BackgroundTasks,
    _admin: User = Depends(require_admin),
) -> RunNowResponse:
    """Trigger an immediate ingestion run. Admin only.

    The ingestion runs as a background task; this endpoint returns
    immediately with a confirmation.
    """
    background_tasks.add_task(_run_ingestion_background)
    return RunNowResponse(
        message="Ingestion triggered successfully",
        status="running",
    )


# --- Parameterized routes ---


@router.get("/{category}", response_model=list[ConfigResponse])
async def get_configuration_by_category(
    category: ConfigCategoryEnum,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[ConfigResponse]:
    """Get all configuration entries for a specific category."""
    query = select(Configuration).where(Configuration.category == category.value).order_by(Configuration.key)
    result = await db.execute(query)
    configs = result.scalars().all()
    return [ConfigResponse.model_validate(c) for c in configs]


@router.get("/{category}/{key}", response_model=ConfigResponse)
async def get_configuration(
    category: str,
    key: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> ConfigResponse:
    """Get a specific configuration entry by category and key."""
    result = await db.execute(
        select(Configuration).where(
            Configuration.category == category,
            Configuration.key == key,
        )
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail=f"Configuration '{category}/{key}' not found")
    return ConfigResponse.model_validate(config)


@router.put("/{category}/{key}", response_model=ConfigResponse)
async def update_configuration(
    category: ConfigCategoryEnum,
    key: str,
    body: ConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ConfigResponse:
    """Update a configuration value. Creates the entry if it does not exist."""
    result = await db.execute(
        select(Configuration).where(
            Configuration.category == category.value,
            Configuration.key == key,
        )
    )
    config = result.scalar_one_or_none()

    if config is None:
        config = Configuration(
            category=category.value,
            key=key,
            value=body.value,
            description=body.description,
        )
        db.add(config)
    else:
        config.value = body.value
        if body.description is not None:
            config.description = body.description
        db.add(config)

    await db.flush()
    await db.refresh(config)
    return ConfigResponse.model_validate(config)
