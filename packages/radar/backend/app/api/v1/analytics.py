"""Analytics endpoints for trends, scores, and ingestion health."""

import math
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from sqlalchemy import String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Depends, get_current_user, get_db, require_admin
from app.models.ingestion_run import IngestionRun
from app.models.research_item import ResearchItem
from app.models.source import Source
from app.models.user import User
from app.schemas.analytics import (
    CostEstimateResponse,
    CostLineItem,
    IngestionHealthResponse,
    IngestionRunSummary,
    ScoreDistribution,
    ScoresResponse,
    SourceHealth,
    TimeSeriesPoint,
    TrendsBySource,
    TrendsResponse,
)

router = APIRouter()

_PERIOD_DAYS = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
}


@router.get("/trends", response_model=TrendsResponse)
async def get_trends(
    period: str = Query(default="30d", pattern="^(7d|30d|90d)$", description="Time period"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> TrendsResponse:
    """Return signals created per day grouped by source for the given period."""
    days = _PERIOD_DAYS[period]
    since = datetime.now(UTC) - timedelta(days=days)

    # Determine dialect for date truncation
    dialect_name = db.bind.dialect.name if db.bind else "postgresql"

    if dialect_name == "sqlite":
        date_col = func.date(ResearchItem.created_at)
    else:
        date_col = func.date_trunc("day", ResearchItem.created_at)

    # Query: count per day per source
    query = (
        select(
            date_col.label("day"),
            ResearchItem.source_id,
            Source.name.label("source_name"),
            func.count(ResearchItem.id).label("cnt"),
        )
        .join(Source, ResearchItem.source_id == Source.id)
        .where(ResearchItem.created_at >= since)
        .group_by(date_col, ResearchItem.source_id, Source.name)
        .order_by(date_col)
    )

    result = await db.execute(query)
    rows = result.all()

    # Build response grouped by source
    source_map: dict[str, TrendsBySource] = {}
    total = 0

    for row in rows:
        day_val = row.day
        # Normalize date to string
        if isinstance(day_val, datetime):
            date_str = day_val.strftime("%Y-%m-%d")
        else:
            date_str = str(day_val)

        source_id_str = str(row.source_id)
        if source_id_str not in source_map:
            source_map[source_id_str] = TrendsBySource(
                source_id=source_id_str,
                source_name=row.source_name,
                data=[],
            )
        source_map[source_id_str].data.append(
            TimeSeriesPoint(date=date_str, count=row.cnt)
        )
        total += row.cnt

    return TrendsResponse(
        period=period,
        total=total,
        by_source=list(source_map.values()),
    )


@router.get("/scores", response_model=ScoresResponse)
async def get_scores(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScoresResponse:
    """Return score distributions and aggregations for research items."""
    # Scientific score histogram
    scientific_hist = await _score_histogram(db, ResearchItem.scientific_strength_score)
    # Strategic score histogram
    strategic_hist = await _score_histogram(db, ResearchItem.strategic_relevance_score)

    # Average scores
    avg_query = select(
        func.avg(ResearchItem.scientific_strength_score),
        func.avg(ResearchItem.strategic_relevance_score),
    )
    avg_result = await db.execute(avg_query)
    avg_row = avg_result.one()
    avg_scientific = float(avg_row[0]) if avg_row[0] is not None else None
    avg_strategic = float(avg_row[1]) if avg_row[1] is not None else None

    # Count by strategic_bucket (unnest JSONB array - Python-side for SQLite compat)
    by_bucket: dict[str, int] = {}
    bucket_query = select(ResearchItem.strategic_buckets).where(
        ResearchItem.strategic_buckets.isnot(None)
    )
    bucket_result = await db.execute(bucket_query)
    for (buckets,) in bucket_result.all():
        if isinstance(buckets, list):
            for b in buckets:
                by_bucket[b] = by_bucket.get(b, 0) + 1

    # Count by hype_risk
    hype_query = (
        select(ResearchItem.hype_risk, func.count(ResearchItem.id))
        .where(ResearchItem.hype_risk.isnot(None))
        .group_by(ResearchItem.hype_risk)
    )
    hype_result = await db.execute(hype_query)
    by_hype_risk = {row[0]: row[1] for row in hype_result.all()}

    # Count by recommended_action
    action_query = (
        select(ResearchItem.recommended_action, func.count(ResearchItem.id))
        .where(ResearchItem.recommended_action.isnot(None))
        .group_by(ResearchItem.recommended_action)
    )
    action_result = await db.execute(action_query)
    by_recommended_action = {row[0]: row[1] for row in action_result.all()}

    return ScoresResponse(
        scientific=scientific_hist,
        strategic=strategic_hist,
        avg_scientific=avg_scientific,
        avg_strategic=avg_strategic,
        by_bucket=by_bucket,
        by_hype_risk=by_hype_risk,
        by_recommended_action=by_recommended_action,
    )


async def _score_histogram(db: AsyncSession, score_column) -> list[ScoreDistribution]:
    """Build a histogram of scores in integer buckets 0-1, 1-2, ..., 9-10."""
    query = select(score_column).where(score_column.isnot(None))
    result = await db.execute(query)
    scores = [float(row[0]) for row in result.all()]

    # Count into buckets
    bucket_counts: dict[str, int] = {}
    for i in range(10):
        bucket_counts[f"{i}-{i + 1}"] = 0

    for score in scores:
        idx = int(math.floor(score))
        # Clamp: score of exactly 10.0 goes into "9-10"
        if idx >= 10:
            idx = 9
        if idx < 0:
            idx = 0
        key = f"{idx}-{idx + 1}"
        bucket_counts[key] = bucket_counts.get(key, 0) + 1

    return [ScoreDistribution(bucket=k, count=v) for k, v in bucket_counts.items()]


@router.get("/ingestion", response_model=IngestionHealthResponse)
async def get_ingestion_health(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> IngestionHealthResponse:
    """Return ingestion health: recent runs, source health, and 24h totals."""
    now = datetime.now(UTC)
    twenty_four_hours_ago = now - timedelta(hours=24)
    seven_days_ago = now - timedelta(days=7)

    # Recent 20 ingestion runs with source names
    recent_query = (
        select(IngestionRun, Source.name.label("source_name"))
        .join(Source, IngestionRun.source_id == Source.id)
        .order_by(IngestionRun.started_at.desc())
        .limit(20)
    )
    recent_result = await db.execute(recent_query)
    recent_rows = recent_result.all()

    recent_runs = []
    for row in recent_rows:
        run = row[0]  # IngestionRun object
        source_name = row.source_name

        duration = None
        if run.completed_at and run.started_at:
            duration = (run.completed_at - run.started_at).total_seconds()

        recent_runs.append(
            IngestionRunSummary(
                id=str(run.id),
                source_name=source_name,
                started_at=run.started_at,
                status=run.status,
                items_fetched=run.items_fetched,
                items_new=run.items_new,
                items_duplicate=run.items_duplicate,
                duration_seconds=duration,
            )
        )

    # Source health: for each source, last fetch, runs in 7d, error rate
    sources_query = select(Source)
    sources_result = await db.execute(sources_query)
    sources = sources_result.scalars().all()

    sources_health = []
    for source in sources:
        # Count runs in last 7 days
        runs_7d_query = (
            select(func.count(IngestionRun.id))
            .where(IngestionRun.source_id == source.id)
            .where(IngestionRun.started_at >= seven_days_ago)
        )
        runs_7d_result = await db.execute(runs_7d_query)
        runs_7d = runs_7d_result.scalar_one()

        # Count failed runs in last 7 days
        failed_7d_query = (
            select(func.count(IngestionRun.id))
            .where(IngestionRun.source_id == source.id)
            .where(IngestionRun.started_at >= seven_days_ago)
            .where(IngestionRun.status == "failed")
        )
        failed_7d_result = await db.execute(failed_7d_query)
        failed_7d = failed_7d_result.scalar_one()

        error_rate = (failed_7d / runs_7d * 100) if runs_7d > 0 else 0.0

        sources_health.append(
            SourceHealth(
                source_name=source.name,
                last_fetched_at=source.last_fetched_at,
                runs_7d=runs_7d,
                error_rate=round(error_rate, 2),
            )
        )

    # Total items processed in last 24h
    processed_24h_query = select(
        func.coalesce(func.sum(IngestionRun.items_processed), 0)
    ).where(IngestionRun.started_at >= twenty_four_hours_ago)
    processed_24h_result = await db.execute(processed_24h_query)
    total_processed_24h = processed_24h_result.scalar_one()

    # Total errors in last 24h (count of failed runs)
    errors_24h_query = (
        select(func.count(IngestionRun.id))
        .where(IngestionRun.started_at >= twenty_four_hours_ago)
        .where(IngestionRun.status == "failed")
    )
    errors_24h_result = await db.execute(errors_24h_query)
    total_errors_24h = errors_24h_result.scalar_one()

    return IngestionHealthResponse(
        recent_runs=recent_runs,
        sources_health=sources_health,
        total_processed_24h=total_processed_24h,
        total_errors_24h=total_errors_24h,
    )


# ── GCP Cost Estimation Constants ─────────────────────────────────────────────
# Prices are approximate GCP list prices as of early 2025.
_CLOUD_RUN_VCPU_PER_SECOND = Decimal("0.00002400")
_CLOUD_RUN_GB_PER_SECOND = Decimal("0.00000250")
_AVG_RUN_DURATION_SECONDS = Decimal("120")  # estimated avg ingestion run duration
_AVG_RUN_VCPU = Decimal("1")
_AVG_RUN_MEMORY_GB = Decimal("0.5")

_CLOUD_RUN_FRONTEND_MONTHLY = Decimal("2.00")
_CLOUD_SQL_MONTHLY = Decimal("7.67")  # db-f1-micro

# LLM pricing: 4 calls with gpt-4o-mini + 1 call with gpt-4o per signal
_MINI_INPUT_PER_1M = Decimal("0.15")   # gpt-4o-mini input
_MINI_OUTPUT_PER_1M = Decimal("0.60")  # gpt-4o-mini output
_FULL_INPUT_PER_1M = Decimal("2.50")   # gpt-4o input
_FULL_OUTPUT_PER_1M = Decimal("10.00") # gpt-4o output
_MINI_CALLS_PER_SIGNAL = 4            # classification, strategic, scoring, impact
_FULL_CALLS_PER_SIGNAL = 1            # summary only
_AVG_INPUT_TOKENS_PER_CALL = 1500
_AVG_OUTPUT_TOKENS_PER_CALL = 500

_CLOUD_BUILD_PER_MINUTE = Decimal("0.003")
_AVG_BUILD_MINUTES = Decimal("8")
_ESTIMATED_DEPLOYS_PER_MONTH = 4

_TWO_PLACES = Decimal("0.01")


@router.get("/costs", response_model=CostEstimateResponse)
async def get_cost_estimate(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CostEstimateResponse:
    """Return estimated GCP monthly costs based on actual usage data.

    Costs are estimates derived from ingestion run counts and processed signals.
    Actual billing may differ. Requires admin privileges.
    """
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Count ingestion runs this month
    runs_query = (
        select(func.count(IngestionRun.id))
        .where(IngestionRun.started_at >= month_start)
    )
    runs_result = await db.execute(runs_query)
    ingestion_run_count = runs_result.scalar_one()

    # Sum items_processed this month (signals sent through LLM scoring)
    processed_query = (
        select(func.coalesce(func.sum(IngestionRun.items_processed), 0))
        .where(IngestionRun.started_at >= month_start)
    )
    processed_result = await db.execute(processed_query)
    signals_processed = processed_result.scalar_one()

    # Count scored signals this month (cross-check via research_items)
    scored_query = (
        select(func.count(ResearchItem.id))
        .where(ResearchItem.created_at >= month_start)
        .where(ResearchItem.scientific_strength_score.isnot(None))
    )
    scored_result = await db.execute(scored_query)
    scored_signals = scored_result.scalar_one()

    # Use the higher of the two as the LLM-processed count
    llm_signals = max(signals_processed, scored_signals)

    # ── Cloud Run Backend ──────────────────────────────────────────────────
    # Cost = runs * avg_duration * (vCPU_rate * vCPUs + memory_rate * GB)
    run_count_dec = Decimal(str(ingestion_run_count))
    cloud_run_backend = (
        run_count_dec
        * _AVG_RUN_DURATION_SECONDS
        * (
            _CLOUD_RUN_VCPU_PER_SECOND * _AVG_RUN_VCPU
            + _CLOUD_RUN_GB_PER_SECOND * _AVG_RUN_MEMORY_GB
        )
    ).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    # ── Cloud Run Frontend ─────────────────────────────────────────────────
    cloud_run_frontend = _CLOUD_RUN_FRONTEND_MONTHLY

    # ── Cloud SQL ──────────────────────────────────────────────────────────
    cloud_sql = _CLOUD_SQL_MONTHLY

    # ── OpenAI API ─────────────────────────────────────────────────────────
    # 4 calls/signal with gpt-4o-mini (cheap) + 1 call/signal with gpt-4o (summary)
    llm_dec = Decimal(str(llm_signals))
    mini_input = llm_dec * _MINI_CALLS_PER_SIGNAL * _AVG_INPUT_TOKENS_PER_CALL
    mini_output = llm_dec * _MINI_CALLS_PER_SIGNAL * _AVG_OUTPUT_TOKENS_PER_CALL
    full_input = llm_dec * _FULL_CALLS_PER_SIGNAL * _AVG_INPUT_TOKENS_PER_CALL
    full_output = llm_dec * _FULL_CALLS_PER_SIGNAL * _AVG_OUTPUT_TOKENS_PER_CALL
    openai_cost = (
        (mini_input / Decimal("1000000")) * _MINI_INPUT_PER_1M
        + (mini_output / Decimal("1000000")) * _MINI_OUTPUT_PER_1M
        + (full_input / Decimal("1000000")) * _FULL_INPUT_PER_1M
        + (full_output / Decimal("1000000")) * _FULL_OUTPUT_PER_1M
    ).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    # ── Cloud Build ────────────────────────────────────────────────────────
    cloud_build = (
        Decimal(str(_ESTIMATED_DEPLOYS_PER_MONTH))
        * _AVG_BUILD_MINUTES
        * _CLOUD_BUILD_PER_MINUTE
    ).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    # ── Total ──────────────────────────────────────────────────────────────
    total = (
        cloud_run_backend + cloud_run_frontend + cloud_sql + openai_cost + cloud_build
    ).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    line_items = [
        CostLineItem(
            label="Cloud Run (Backend)",
            amount=float(cloud_run_backend),
            note=f"{ingestion_run_count} ingestion runs x ~{_AVG_RUN_DURATION_SECONDS}s avg",
        ),
        CostLineItem(
            label="Cloud Run (Frontend)",
            amount=float(cloud_run_frontend),
            note="Static serving estimate",
        ),
        CostLineItem(
            label="Cloud SQL (db-f1-micro)",
            amount=float(cloud_sql),
            note="Fixed monthly cost",
        ),
        CostLineItem(
            label="OpenAI API (4o-mini + 4o)",
            amount=float(openai_cost),
            note=f"{llm_signals} signals x {_MINI_CALLS_PER_SIGNAL} mini + {_FULL_CALLS_PER_SIGNAL} full calls",
        ),
        CostLineItem(
            label="Cloud Build",
            amount=float(cloud_build),
            note=f"~{_ESTIMATED_DEPLOYS_PER_MONTH} deploys x {_AVG_BUILD_MINUTES} min",
        ),
    ]

    return CostEstimateResponse(
        period="current_month",
        line_items=line_items,
        total_estimated=float(total),
        currency="USD",
        signals_processed=llm_signals,
        ingestion_runs=ingestion_run_count,
        last_updated=now,
    )
