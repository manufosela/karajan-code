"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchSchedule, updateSchedule, triggerIngestionNow } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import type {
  ScheduleResponse,
  ScheduleType,
  ScheduleUpdatePayload,
  DayOfWeek,
} from "@/types/schedule";
import clsx from "clsx";

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onScheduleUpdated?: (schedule: ScheduleResponse) => void;
}

const ALL_DAYS: { key: DayOfWeek; labelKey: string }[] = [
  { key: "mon", labelKey: "schedule.mon" },
  { key: "tue", labelKey: "schedule.tue" },
  { key: "wed", labelKey: "schedule.wed" },
  { key: "thu", labelKey: "schedule.thu" },
  { key: "fri", labelKey: "schedule.fri" },
  { key: "sat", labelKey: "schedule.sat" },
  { key: "sun", labelKey: "schedule.sun" },
];

const SCHEDULE_TYPE_OPTIONS: { value: ScheduleType; labelKey: string }[] = [
  { value: "daily", labelKey: "schedule.daily" },
  { value: "weekly", labelKey: "schedule.weekly" },
  { value: "monthly", labelKey: "schedule.monthly" },
  { value: "custom", labelKey: "schedule.custom" },
];

const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

export function ScheduleModal({ open, onClose, onScheduleUpdated }: ScheduleModalProps) {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement>(null);

  const [scheduleType, setScheduleType] = useState<ScheduleType>("daily");
  const [time, setTime] = useState("07:00");
  const [daysOfWeek, setDaysOfWeek] = useState<DayOfWeek[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [customCron, setCustomCron] = useState("");
  const [timezone] = useState("Europe/Madrid");

  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<ScheduleResponse["sync_status"] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load current schedule
  useEffect(() => {
    if (!open) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSchedule();
        if (!mounted) return;
        setScheduleType(data.schedule_type);
        setTime(data.time);
        setDaysOfWeek(data.days_of_week);
        setDayOfMonth(data.day_of_month ?? 1);
        setCustomCron(data.custom_cron ?? "");
        setNextRuns(data.next_runs);
        setSyncStatus(data.sync_status);
        setSyncError(data.sync_error);
      } catch {
        if (mounted) setError(t("schedule.loadError"));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [open, t]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const toggleDay = useCallback((day: DayOfWeek) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: ScheduleUpdatePayload = {
        schedule_type: scheduleType,
        time,
        timezone,
        days_of_week: scheduleType === "weekly" ? daysOfWeek : undefined,
        day_of_month: scheduleType === "monthly" ? dayOfMonth : undefined,
        custom_cron: scheduleType === "custom" ? customCron : undefined,
      };

      const result = await updateSchedule(payload);
      setNextRuns(result.next_runs);
      setSyncStatus(result.sync_status);
      setSyncError(result.sync_error);
      setSuccessMsg(t("schedule.saveSuccess"));
      onScheduleUpdated?.(result);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError(t("schedule.saveError"));
    } finally {
      setSaving(false);
    }
  }, [scheduleType, time, timezone, daysOfWeek, dayOfMonth, customCron, t, onScheduleUpdated]);

  const handleRunNow = useCallback(async () => {
    setRunningNow(true);
    setError(null);
    try {
      await triggerIngestionNow();
      setSuccessMsg(t("schedule.runNowSuccess"));
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError(t("schedule.runNowError"));
    } finally {
      setRunningNow(false);
    }
  }, [t]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("schedule.title")}
    >
      <div className="mx-4 w-full max-w-lg rounded-xl bg-[var(--bg-primary)] shadow-2xl border border-[var(--border-primary)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {t("schedule.title")}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("schedule.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label={t("common.cancel")}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
              <span className="ml-3 text-sm text-[var(--text-secondary)]">{t("common.loading")}</span>
            </div>
          ) : (
            <>
              {/* Schedule Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  {t("schedule.typeLabel")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setScheduleType(opt.value)}
                      className={clsx(
                        "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                        scheduleType === opt.value
                          ? "bg-radar-600 text-white"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                      )}
                      aria-pressed={scheduleType === opt.value}
                    >
                      {t(opt.labelKey as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time picker */}
              {scheduleType !== "custom" && (
                <div className="space-y-1.5">
                  <label htmlFor="schedule-time-input" className="text-sm font-medium text-[var(--text-primary)]">
                    {t("schedule.timeLabel")}
                  </label>
                  <input
                    id="schedule-time-input"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="input w-36"
                    aria-label={t("schedule.timeLabel")}
                  />
                </div>
              )}

              {/* Day selector (weekly) */}
              {scheduleType === "weekly" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("schedule.daysLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day.key}
                        onClick={() => toggleDay(day.key)}
                        className={clsx(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                          daysOfWeek.includes(day.key)
                            ? "bg-radar-600 text-white"
                            : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                        )}
                        aria-pressed={daysOfWeek.includes(day.key)}
                      >
                        {t(day.labelKey as Parameters<typeof t>[0])}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Day of month (monthly) */}
              {scheduleType === "monthly" && (
                <div className="space-y-1.5">
                  <label htmlFor="day-of-month" className="text-sm font-medium text-[var(--text-primary)]">
                    {t("schedule.dayOfMonthLabel")}
                  </label>
                  <select
                    id="day-of-month"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                    className="input w-24"
                    aria-label={t("schedule.dayOfMonthLabel")}
                  >
                    {DAY_OF_MONTH_OPTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom cron */}
              {scheduleType === "custom" && (
                <div className="space-y-1.5">
                  <label htmlFor="custom-cron" className="text-sm font-medium text-[var(--text-primary)]">
                    {t("schedule.cronLabel")}
                  </label>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {t("schedule.cronHelp")}
                  </p>
                  <input
                    id="custom-cron"
                    type="text"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    className="input w-full font-mono"
                    placeholder="0 7 * * *"
                    aria-label={t("schedule.cronLabel")}
                  />
                </div>
              )}

              {/* Timezone info */}
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
                <span>{t("schedule.timezone")}: {timezone}</span>
              </div>

              {/* Next runs preview */}
              {nextRuns.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("schedule.nextRuns")}
                  </label>
                  <ul className="space-y-1">
                    {nextRuns.map((run, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <svg className="h-4 w-4 text-radar-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        <span className="font-mono text-xs">
                          {new Date(run).toLocaleString("en-GB", {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZoneName: "short",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cloud Scheduler sync status */}
              {syncStatus && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    Cloud Scheduler
                  </label>
                  <div className="flex items-center gap-2">
                    {syncStatus === "synced" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Synced
                      </span>
                    )}
                    {syncStatus === "pending_sync" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Pending sync
                      </span>
                    )}
                    {syncStatus === "local_only" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                        Local only
                      </span>
                    )}
                  </div>
                  {syncStatus === "pending_sync" && syncError && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {syncError}
                    </p>
                  )}
                </div>
              )}

              {/* Feedback messages */}
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}
              {successMsg && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3">
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">{successMsg}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex items-center justify-between border-t border-[var(--border-primary)] px-6 py-4">
            <button
              onClick={handleRunNow}
              disabled={runningNow}
              className="btn-secondary text-sm"
              aria-label={t("schedule.runNow")}
            >
              {runningNow ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
                  {t("schedule.running")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                  </svg>
                  {t("schedule.runNow")}
                </span>
              )}
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="btn-secondary text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm"
                aria-label={t("schedule.save")}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t("schedule.saving")}
                  </span>
                ) : (
                  t("schedule.save")
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
