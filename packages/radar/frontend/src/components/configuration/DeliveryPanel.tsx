"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { fetchCostEstimate, fetchSchedule, triggerIngestionNow } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "@/lib/i18n";
import { ScheduleModal } from "@/components/configuration/ScheduleModal";
import type { CostEstimateResponse } from "@/types/analytics";
import type { ScheduleResponse } from "@/types/schedule";
import clsx from "clsx";

interface ToastState {
  message: string;
  type: "success" | "error";
  visible: boolean;
}

export function DeliveryPanel() {
  const { isAdmin } = useAuth();
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState>({ message: "", type: "success", visible: false });
  const [costData, setCostData] = useState<CostEstimateResponse | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState(false);

  // Schedule state
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let mounted = true;
    async function loadCosts() {
      setCostLoading(true);
      setCostError(false);
      try {
        const data = await fetchCostEstimate();
        if (mounted) setCostData(data);
      } catch {
        if (mounted) setCostError(true);
      } finally {
        if (mounted) setCostLoading(false);
      }
    }
    loadCosts();
    return () => { mounted = false; };
  }, [isAdmin]);

  // Load schedule data
  useEffect(() => {
    let mounted = true;
    async function loadSchedule() {
      try {
        const data = await fetchSchedule();
        if (mounted) setScheduleData(data);
      } catch {
        // Non-critical: schedule card just won't show next run
      }
    }
    loadSchedule();
    return () => { mounted = false; };
  }, []);

  const handleRunNow = useCallback(async () => {
    setRunningNow(true);
    try {
      await triggerIngestionNow();
      showToast(t("schedule.runNowSuccess"), "success");
    } catch {
      showToast(t("schedule.runNowError"), "error");
    } finally {
      setRunningNow(false);
    }
  }, [showToast, t]);

  const handleScheduleUpdated = useCallback((schedule: ScheduleResponse) => {
    setScheduleData(schedule);
  }, []);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast.visible && (
        <div
          className={clsx(
            "fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-slide-up",
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          )}
          role="alert"
        >
          {toast.message}
        </div>
      )}

      {/* Schedule Modal */}
      <ScheduleModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onScheduleUpdated={handleScheduleUpdated}
      />

      {/* Ingestion Schedule Card */}
      {isAdmin && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-radar-100 dark:bg-radar-900/30">
                  <svg className="h-5 w-5 text-radar-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("schedule.cardTitle")}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {scheduleData?.description ?? t("schedule.defaultDescription")}
                  </p>
                  {scheduleData?.next_runs?.[0] && (
                    <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                      {t("schedule.nextRun")}:{" "}
                      <span className="font-mono">
                        {new Date(scheduleData.next_runs[0]).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                <button
                  onClick={() => setScheduleModalOpen(true)}
                  className="btn-primary text-sm"
                  aria-label={t("schedule.configure")}
                >
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                    {t("schedule.configure")}
                  </span>
                </button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Cost Estimate */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Estimated Monthly Costs</h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  GCP infrastructure cost estimate based on current usage
                </p>
              </div>
              {costData && (
                <div
                  className={clsx(
                    "rounded-full px-3 py-1 text-sm font-bold tabular-nums",
                    costData.total_estimated < 30
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : costData.total_estimated < 80
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  )}
                >
                  ${costData.total_estimated.toFixed(2)}
                </div>
              )}
            </div>
          </CardHeader>
          <CardBody>
            {costLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
                <span className="ml-3 text-sm text-[var(--text-secondary)]">Loading cost data...</span>
              </div>
            )}

            {costError && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">Unable to load cost estimates</p>
              </div>
            )}

            {costData && !costLoading && (
              <div className="space-y-4">
                {/* Cost breakdown */}
                <div className="space-y-2">
                  {costData.line_items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] px-4 py-3 transition-colors hover:bg-[var(--bg-tertiary)]"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{item.label}</span>
                        {item.note && (
                          <span className="text-xs text-[var(--text-tertiary)]">{item.note}</span>
                        )}
                      </div>
                      <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">
                        ${item.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}

                  {/* Total row */}
                  <div className="flex items-center justify-between rounded-lg bg-[var(--bg-tertiary)] px-4 py-3">
                    <span className="text-sm font-bold text-[var(--text-primary)]">Total Estimated</span>
                    <span
                      className={clsx(
                        "text-base font-bold font-mono tabular-nums",
                        costData.total_estimated < 30
                          ? "text-emerald-600 dark:text-emerald-400"
                          : costData.total_estimated < 80
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                      )}
                    >
                      ${costData.total_estimated.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Usage stats */}
                <div className="flex items-center gap-6 text-xs text-[var(--text-secondary)]">
                  <span>
                    <span className="font-medium">{costData.signals_processed}</span> signals processed
                  </span>
                  <span>
                    <span className="font-medium">{costData.ingestion_runs}</span> ingestion runs
                  </span>
                  <span>
                    Updated {formatDate(costData.last_updated, "d MMM yyyy, HH:mm")}
                  </span>
                </div>

                {/* Disclaimer */}
                <div className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                  <div className="flex items-start gap-2">
                    <svg className="h-4 w-4 mt-0.5 text-[var(--text-tertiary)] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Estimates based on usage data. Actual GCP billing may vary.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

    </div>
  );
}
