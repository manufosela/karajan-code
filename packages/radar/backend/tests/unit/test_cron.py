"""Tests for cron utility functions."""

import pytest

from app.utils.cron import (
    calculate_next_runs,
    describe_schedule,
    generate_cron,
    generate_gcloud_command,
)


class TestGenerateCron:
    """Tests for generate_cron()."""

    def test_daily(self) -> None:
        assert generate_cron("daily", "07:00") == "00 07 * * *"

    def test_daily_afternoon(self) -> None:
        assert generate_cron("daily", "14:30") == "30 14 * * *"

    def test_weekly_single_day(self) -> None:
        assert generate_cron("weekly", "08:00", days_of_week=["mon"]) == "00 08 * * 1"

    def test_weekly_multiple_days(self) -> None:
        result = generate_cron("weekly", "09:00", days_of_week=["tue", "thu"])
        assert result == "00 09 * * 2,4"

    def test_weekly_all_days(self) -> None:
        result = generate_cron(
            "weekly", "06:00",
            days_of_week=["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        )
        assert "00 06 * *" in result

    def test_monthly(self) -> None:
        assert generate_cron("monthly", "12:00", day_of_month=15) == "00 12 15 * *"

    def test_monthly_first_day(self) -> None:
        assert generate_cron("monthly", "00:00", day_of_month=1) == "00 00 1 * *"

    def test_custom(self) -> None:
        assert generate_cron("custom", "00:00", custom_cron="*/30 * * * *") == "*/30 * * * *"

    def test_weekly_missing_days_raises(self) -> None:
        with pytest.raises(ValueError, match="days_of_week"):
            generate_cron("weekly", "08:00")

    def test_weekly_invalid_day_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid day"):
            generate_cron("weekly", "08:00", days_of_week=["monday"])

    def test_monthly_missing_day_raises(self) -> None:
        with pytest.raises(ValueError, match="day_of_month"):
            generate_cron("monthly", "08:00")

    def test_monthly_day_out_of_range_raises(self) -> None:
        with pytest.raises(ValueError, match="1 and 28"):
            generate_cron("monthly", "08:00", day_of_month=29)

    def test_custom_empty_raises(self) -> None:
        with pytest.raises(ValueError, match="custom_cron"):
            generate_cron("custom", "00:00")

    def test_custom_invalid_fields_raises(self) -> None:
        with pytest.raises(ValueError, match="5 fields"):
            generate_cron("custom", "00:00", custom_cron="* * *")

    def test_invalid_time_raises(self) -> None:
        with pytest.raises(ValueError, match="Hour must be 0-23"):
            generate_cron("daily", "25:00")

    def test_invalid_time_format_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid time"):
            generate_cron("daily", "abc")

    def test_invalid_schedule_type_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown schedule_type"):
            generate_cron("hourly", "08:00")  # type: ignore[arg-type]


class TestCalculateNextRuns:
    """Tests for calculate_next_runs()."""

    def test_daily_returns_correct_count(self) -> None:
        runs = calculate_next_runs("daily", "07:00", "Europe/Madrid", count=5)
        assert len(runs) == 5

    def test_daily_returns_3_by_default(self) -> None:
        runs = calculate_next_runs("daily", "07:00", "Europe/Madrid")
        assert len(runs) == 3

    def test_weekly_returns_only_matching_days(self) -> None:
        runs = calculate_next_runs(
            "weekly", "08:00", "Europe/Madrid",
            days_of_week=["mon"], count=3,
        )
        assert len(runs) == 3
        # All runs should be on a Monday (weekday 0)
        for run_str in runs:
            from datetime import datetime
            dt = datetime.fromisoformat(run_str)
            assert dt.weekday() == 0  # Monday

    def test_monthly_returns_correct_day(self) -> None:
        runs = calculate_next_runs(
            "monthly", "09:00", "Europe/Madrid",
            day_of_month=15, count=3,
        )
        assert len(runs) == 3
        for run_str in runs:
            from datetime import datetime
            dt = datetime.fromisoformat(run_str)
            assert dt.day == 15

    def test_weekly_no_days_returns_empty(self) -> None:
        runs = calculate_next_runs("weekly", "08:00", "Europe/Madrid")
        assert runs == []

    def test_monthly_no_day_returns_empty(self) -> None:
        runs = calculate_next_runs("monthly", "08:00", "Europe/Madrid")
        assert runs == []

    def test_runs_are_in_future(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        runs = calculate_next_runs("daily", "07:00", "Europe/Madrid")
        now = datetime.now(ZoneInfo("Europe/Madrid"))
        for run_str in runs:
            dt = datetime.fromisoformat(run_str)
            assert dt > now


class TestDescribeSchedule:
    """Tests for describe_schedule()."""

    def test_daily(self) -> None:
        assert describe_schedule("daily", "07:00") == "Every day at 07:00"

    def test_weekly_single(self) -> None:
        result = describe_schedule("weekly", "08:00", days_of_week=["mon"])
        assert result == "Every Monday at 08:00"

    def test_weekly_multiple(self) -> None:
        result = describe_schedule("weekly", "08:00", days_of_week=["tue", "thu"])
        assert result == "Every Tuesday and Thursday at 08:00"

    def test_weekly_three(self) -> None:
        result = describe_schedule("weekly", "08:00", days_of_week=["mon", "wed", "fri"])
        assert result == "Every Monday, Wednesday and Friday at 08:00"

    def test_monthly(self) -> None:
        result = describe_schedule("monthly", "09:00", day_of_month=15)
        assert result == "Monthly on day 15 at 09:00"

    def test_custom(self) -> None:
        result = describe_schedule("custom", "00:00")
        assert result == "Custom cron schedule"


class TestGenerateGcloudCommand:
    """Tests for generate_gcloud_command()."""

    def test_generates_correct_command(self) -> None:
        result = generate_gcloud_command("00 07 * * *", "Europe/Madrid")
        assert "gcloud scheduler jobs update http ofr-daily-ingestion" in result
        assert "--location europe-west1" in result
        assert '--schedule "00 07 * * *"' in result
        assert '--time-zone "Europe/Madrid"' in result
