"""Cron expression generation and next-run calculation for ingestion scheduling.

Supports daily, weekly, monthly, and custom schedule types without external
dependencies (no croniter).
"""

from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

ScheduleType = Literal["daily", "weekly", "monthly", "custom"]

DAY_MAP: dict[str, int] = {
    "mon": 1,
    "tue": 2,
    "wed": 3,
    "thu": 4,
    "fri": 5,
    "sat": 6,
    "sun": 0,
}

DAY_LABELS: dict[str, str] = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}

# Reverse: Python weekday (0=Mon) -> our abbreviation
_PYTHON_WEEKDAY_TO_ABBR: dict[int, str] = {
    0: "mon",
    1: "tue",
    2: "wed",
    3: "thu",
    4: "fri",
    5: "sat",
    6: "sun",
}

VALID_DAYS = set(DAY_MAP.keys())


def generate_cron(
    schedule_type: ScheduleType,
    time: str,
    days_of_week: list[str] | None = None,
    day_of_month: int | None = None,
    custom_cron: str | None = None,
) -> str:
    """Generate a cron expression from schedule parameters.

    Args:
        schedule_type: One of 'daily', 'weekly', 'monthly', 'custom'.
        time: Time in HH:MM 24h format.
        days_of_week: List of day abbreviations for weekly (e.g. ['mon', 'wed']).
        day_of_month: Day number (1-28) for monthly.
        custom_cron: Raw cron expression for custom type.

    Returns:
        A standard 5-field cron expression string.

    Raises:
        ValueError: If the input parameters are invalid.
    """
    if schedule_type == "custom":
        if not custom_cron or not custom_cron.strip():
            raise ValueError("custom_cron is required for schedule_type 'custom'")
        parts = custom_cron.strip().split()
        if len(parts) != 5:
            raise ValueError(f"Custom cron must have exactly 5 fields, got {len(parts)}")
        return custom_cron.strip()

    _validate_time(time)
    hour, minute = time.split(":")

    if schedule_type == "daily":
        return f"{minute} {hour} * * *"

    if schedule_type == "weekly":
        if not days_of_week:
            raise ValueError("days_of_week is required for schedule_type 'weekly'")
        invalid = set(days_of_week) - VALID_DAYS
        if invalid:
            raise ValueError(f"Invalid day abbreviations: {', '.join(sorted(invalid))}")
        cron_days = ",".join(str(DAY_MAP[d]) for d in days_of_week)
        return f"{minute} {hour} * * {cron_days}"

    if schedule_type == "monthly":
        if day_of_month is None:
            raise ValueError("day_of_month is required for schedule_type 'monthly'")
        if not (1 <= day_of_month <= 28):
            raise ValueError("day_of_month must be between 1 and 28")
        return f"{minute} {hour} {day_of_month} * *"

    raise ValueError(f"Unknown schedule_type: {schedule_type}")


def calculate_next_runs(
    schedule_type: ScheduleType,
    time: str,
    timezone: str,
    days_of_week: list[str] | None = None,
    day_of_month: int | None = None,
    count: int = 3,
) -> list[str]:
    """Calculate the next N run times for a schedule.

    Args:
        schedule_type: One of 'daily', 'weekly', 'monthly'.
        time: Time in HH:MM 24h format.
        timezone: IANA timezone string (e.g. 'Europe/Madrid').
        days_of_week: Day abbreviations for weekly schedules.
        day_of_month: Day number for monthly schedules.
        count: Number of next runs to calculate.

    Returns:
        List of ISO 8601 formatted datetime strings with timezone offset.
    """
    tz = ZoneInfo(timezone)
    now = datetime.now(tz)
    hour, minute = (int(x) for x in time.split(":"))

    runs: list[str] = []

    if schedule_type == "daily":
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        while len(runs) < count:
            runs.append(candidate.isoformat())
            candidate += timedelta(days=1)

    elif schedule_type == "weekly":
        if not days_of_week:
            return []
        # Convert to Python weekday numbers (0=Monday)
        target_weekdays = sorted(
            {list(_PYTHON_WEEKDAY_TO_ABBR.keys())[list(_PYTHON_WEEKDAY_TO_ABBR.values()).index(d)] for d in days_of_week}
        )
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        while len(runs) < count:
            if candidate.weekday() in target_weekdays:
                runs.append(candidate.isoformat())
            candidate += timedelta(days=1)

    elif schedule_type == "monthly":
        if day_of_month is None:
            return []
        # Start from current month
        candidate = now.replace(day=day_of_month, hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            # Move to next month
            if candidate.month == 12:
                candidate = candidate.replace(year=candidate.year + 1, month=1)
            else:
                candidate = candidate.replace(month=candidate.month + 1)
        while len(runs) < count:
            runs.append(candidate.isoformat())
            if candidate.month == 12:
                candidate = candidate.replace(year=candidate.year + 1, month=1)
            else:
                candidate = candidate.replace(month=candidate.month + 1)

    return runs


def describe_schedule(
    schedule_type: ScheduleType,
    time: str,
    days_of_week: list[str] | None = None,
    day_of_month: int | None = None,
) -> str:
    """Return a human-readable description of the schedule.

    Examples:
        'Every day at 07:00'
        'Every Tuesday and Thursday at 08:00'
        'Monthly on day 15 at 09:00'
    """
    if schedule_type == "daily":
        return f"Every day at {time}"

    if schedule_type == "weekly" and days_of_week:
        day_names = [DAY_LABELS[d] for d in days_of_week]
        if len(day_names) == 1:
            return f"Every {day_names[0]} at {time}"
        return f"Every {', '.join(day_names[:-1])} and {day_names[-1]} at {time}"

    if schedule_type == "monthly" and day_of_month is not None:
        return f"Monthly on day {day_of_month} at {time}"

    if schedule_type == "custom":
        return "Custom cron schedule"

    return "Unknown schedule"


def generate_gcloud_command(cron_expression: str, timezone: str) -> str:
    """Generate the gcloud CLI command to sync the schedule to Cloud Scheduler.

    Args:
        cron_expression: The cron expression to set.
        timezone: IANA timezone string.

    Returns:
        The full gcloud command string.
    """
    return (
        f'gcloud scheduler jobs update http ofr-daily-ingestion '
        f'--location europe-west1 '
        f'--schedule "{cron_expression}" '
        f'--time-zone "{timezone}"'
    )


def _validate_time(time: str) -> None:
    """Validate a HH:MM time string."""
    parts = time.split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time format '{time}', expected HH:MM")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        raise ValueError(f"Invalid time format '{time}', expected numeric HH:MM")
    if not (0 <= hour <= 23):
        raise ValueError(f"Hour must be 0-23, got {hour}")
    if not (0 <= minute <= 59):
        raise ValueError(f"Minute must be 0-59, got {minute}")
