/**
 * Schedule types - aligned with backend schemas (configuration.py)
 */

export type ScheduleType = "daily" | "weekly" | "monthly" | "custom";

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ScheduleResponse {
  schedule_type: ScheduleType;
  time: string;
  timezone: string;
  days_of_week: DayOfWeek[];
  day_of_month: number | null;
  custom_cron: string | null;
  cron_expression: string;
  description: string;
  next_runs: string[];
  sync_status: "synced" | "pending_sync" | "local_only";
  sync_error: string | null;
}

export interface ScheduleUpdatePayload {
  schedule_type: ScheduleType;
  time: string;
  timezone?: string;
  days_of_week?: DayOfWeek[];
  day_of_month?: number | null;
  custom_cron?: string | null;
}

export interface RunNowResponse {
  message: string;
  status: string;
}
