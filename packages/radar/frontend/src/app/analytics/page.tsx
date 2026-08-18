"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingCards } from "@/components/ui/LoadingState";
import { ScoreBadge } from "@/components/signals/ScoreBadge";
import {
  fetchAnalyticsTrends,
  fetchAnalyticsScores,
  fetchAnalyticsIngestion,
} from "@/lib/api";
import type {
  AnalyticsTrendsResponse,
  AnalyticsScoresResponse,
  AnalyticsIngestionResponse,
  ScoreBucketEntry,
} from "@/types/analytics";
import clsx from "clsx";

/* ─── Tab types ─────────────────────────────────────────── */

type AnalyticsTab = "trends" | "scores" | "ingestion";
type TrendPeriod = "7d" | "30d" | "90d";

interface TabDef {
  id: AnalyticsTab;
  labelKey:
    | "analytics.trends"
    | "analytics.scores"
    | "analytics.ingestion";
  descriptionKey:
    | "analytics.trendsDesc"
    | "analytics.scoresDesc"
    | "analytics.ingestionDesc";
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: "trends",
    labelKey: "analytics.trends",
    descriptionKey: "analytics.trendsDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
      </svg>
    ),
  },
  {
    id: "scores",
    labelKey: "analytics.scores",
    descriptionKey: "analytics.scoresDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    id: "ingestion",
    labelKey: "analytics.ingestion",
    descriptionKey: "analytics.ingestionDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75" />
      </svg>
    ),
  },
];

/* ─── Reusable horizontal bar component ─────────────────── */

interface HBarProps {
  label: string;
  value: number;
  maxValue: number;
  color?: string;
}

function HBar({ label, value, maxValue, color = "bg-radar-500" }: HBarProps) {
  const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-28 shrink-0 truncate text-sm text-[var(--text-secondary)]" title={label}>
        {label}
      </span>
      <div className="relative flex-1 h-5 rounded bg-[var(--bg-secondary)]">
        <div
          className={clsx("h-full rounded transition-all duration-500", color)}
          style={{ width: `${pct}%`, minWidth: value > 0 ? "4px" : "0" }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

/* ─── KPI card ──────────────────────────────────────────── */

interface KpiCardProps {
  label: string;
  value: string | number;
  color?: string;
}

function KpiCard({ label, value, color }: KpiCardProps) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center justify-center py-5">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className={clsx("mt-1 text-3xl font-bold tabular-nums", color ?? "text-[var(--text-primary)]")}>
          {value}
        </span>
      </CardBody>
    </Card>
  );
}

/* ─── Helper: format date for display ───────────────────── */

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ─── Bar color palette (cycle for multiple sources) ───── */

const BAR_COLORS = [
  "bg-radar-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-blue-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
];

/* ─── Trends panel ──────────────────────────────────────── */

function TrendsPanel() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<TrendPeriod>("30d");
  const [data, setData] = useState<AnalyticsTrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: TrendPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchAnalyticsTrends(p);
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const handlePeriodChange = useCallback((p: TrendPeriod) => {
    setPeriod(p);
  }, []);

  /** Aggregate total per source across all data points */
  const sourceTotals = useMemo(() => {
    if (!data) return [];
    return data.by_source
      .map((s) => ({
        name: s.source_name,
        total: s.data.reduce((sum, d) => sum + d.count, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  const maxSourceTotal = useMemo(
    () => Math.max(1, ...sourceTotals.map((s) => s.total)),
    [sourceTotals]
  );

  /** Daily aggregation (sum all sources per date) */
  const dailyCounts = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const src of data.by_source) {
      for (const pt of src.data) {
        map.set(pt.date, (map.get(pt.date) ?? 0) + pt.count);
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [data]);

  const maxDailyCount = useMemo(
    () => Math.max(1, ...dailyCounts.map((d) => d.count)),
    [dailyCounts]
  );

  if (loading) return <LoadingCards count={3} />;

  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-red-500">{error}</p>
        </CardBody>
      </Card>
    );
  }

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-[var(--text-tertiary)]">{t("analytics.noTrendData")}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period selector + KPI */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-[var(--bg-secondary)] p-1">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => handlePeriodChange(p)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                period === p
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              {t(`analytics.period${p}` as "analytics.period7d" | "analytics.period30d" | "analytics.period90d")}
            </button>
          ))}
        </div>
        <KpiCard label={t("analytics.totalSignals")} value={data.total} color="text-radar-600 dark:text-radar-400" />
      </div>

      {/* Signals per source */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("analytics.signalsPerSource")}</h3>
        </CardHeader>
        <CardBody>
          {sourceTotals.map((s, i) => (
            <HBar
              key={s.name}
              label={s.name}
              value={s.total}
              maxValue={maxSourceTotal}
              color={BAR_COLORS[i % BAR_COLORS.length]}
            />
          ))}
        </CardBody>
      </Card>

      {/* Signals by day */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("analytics.signalsByDay")}</h3>
        </CardHeader>
        <CardBody className="max-h-80 overflow-y-auto">
          {dailyCounts.map((d) => (
            <HBar
              key={d.date}
              label={fmtDate(d.date)}
              value={d.count}
              maxValue={maxDailyCount}
              color="bg-radar-400"
            />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/* ─── Score distribution component ──────────────────────── */

interface ScoreDistProps {
  title: string;
  buckets: ScoreBucketEntry[];
  color: string;
}

function ScoreDistribution({ title, buckets, color }: ScoreDistProps) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </CardHeader>
      <CardBody>
        {buckets.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">--</p>
        ) : (
          buckets.map((b) => (
            <HBar key={b.bucket} label={b.bucket} value={b.count} maxValue={maxCount} color={color} />
          ))
        )}
      </CardBody>
    </Card>
  );
}

/* ─── Record-to-bars helper ─────────────────────────────── */

interface RecordBarsProps {
  title: string;
  data: Record<string, number>;
  color: string;
}

function RecordBars({ title, data, color }: RecordBarsProps) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const maxVal = Math.max(1, ...entries.map(([, v]) => v));

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </CardHeader>
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">--</p>
        ) : (
          entries.map(([key, val]) => (
            <HBar key={key} label={key} value={val} maxValue={maxVal} color={color} />
          ))
        )}
      </CardBody>
    </Card>
  );
}

/* ─── Scores panel ──────────────────────────────────────── */

function ScoresPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<AnalyticsScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetchAnalyticsScores();
        if (!cancelled) setData(resp);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingCards count={4} />;

  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-red-500">{error}</p>
        </CardBody>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-[var(--text-tertiary)]">{t("analytics.noScoreData")}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Average score KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardBody className="flex items-center justify-center gap-4 py-5">
            <ScoreBadge score={data.avg_scientific} variant="circle" size="lg" />
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t("analytics.avgScientific")}</span>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center justify-center gap-4 py-5">
            <ScoreBadge score={data.avg_strategic} variant="circle" size="lg" />
            <span className="text-sm font-medium text-[var(--text-secondary)]">{t("analytics.avgStrategic")}</span>
          </CardBody>
        </Card>
      </div>

      {/* Score distributions side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ScoreDistribution
          title={t("analytics.scientificDist")}
          buckets={data.scientific}
          color="bg-emerald-500"
        />
        <ScoreDistribution
          title={t("analytics.strategicDist")}
          buckets={data.strategic}
          color="bg-radar-500"
        />
      </div>

      {/* Bucket / Hype / Action breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RecordBars title={t("analytics.byBucket")} data={data.by_bucket} color="bg-blue-500" />
        <RecordBars title={t("analytics.byHypeRisk")} data={data.by_hype_risk} color="bg-amber-500" />
        <RecordBars title={t("analytics.byAction")} data={data.by_recommended_action} color="bg-violet-500" />
      </div>
    </div>
  );
}

/* ─── Ingestion panel ───────────────────────────────────── */

function IngestionPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<AnalyticsIngestionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetchAnalyticsIngestion();
        if (!cancelled) setData(resp);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingCards count={3} />;

  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-red-500">{error}</p>
        </CardBody>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-[var(--text-tertiary)]">{t("analytics.noIngestionData")}</p>
        </CardBody>
      </Card>
    );
  }

  const statusColor = (s: string): "green" | "yellow" | "gray" | "blue" | "orange" => {
    const lower = s.toLowerCase();
    if (lower === "success" || lower === "completed") return "green";
    if (lower === "running" || lower === "in_progress") return "blue";
    if (lower === "failed" || lower === "error") return "orange";
    return "gray";
  };

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          label={t("analytics.processed24h")}
          value={data.total_processed_24h}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label={t("analytics.errors24h")}
          value={data.total_errors_24h}
          color={data.total_errors_24h > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
        />
      </div>

      {/* Recent runs table */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("analytics.recentRuns")}</h3>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {data.recent_runs.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[var(--text-tertiary)]">--</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)]">{t("analytics.sourceName")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)]">{t("table.date")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)]">{t("analytics.status")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)] text-right">{t("analytics.fetched")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)] text-right">{t("analytics.new")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)] text-right">{t("analytics.duplicate")}</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-tertiary)] text-right">{t("analytics.duration")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.slice(0, 10).map((run) => (
                  <tr key={run.id} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-3 text-[var(--text-primary)]">{run.source_name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{fmtDateTime(run.started_at)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="status" statusColor={statusColor(run.status)}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">{run.items_fetched}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{run.items_new}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-tertiary)]">{run.items_duplicate}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {run.duration_seconds.toFixed(1)}{t("analytics.seconds")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Sources health */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("analytics.sourcesHealth")}</h3>
        </CardHeader>
        <CardBody>
          {data.sources_health.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">--</p>
          ) : (
            <div className="space-y-3">
              {data.sources_health.map((src) => (
                <div
                  key={src.source_id}
                  className="flex flex-col gap-1 rounded-lg border border-[var(--border-primary)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        "h-2.5 w-2.5 rounded-full",
                        src.is_healthy ? "bg-emerald-500" : "bg-red-500"
                      )}
                    />
                    <span className="font-medium text-[var(--text-primary)]">{src.source_name}</span>
                    <Badge variant="status" statusColor={src.is_healthy ? "green" : "orange"}>
                      {src.is_healthy ? t("analytics.healthy") : t("analytics.unhealthy")}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-xs text-[var(--text-tertiary)]">
                    <span>
                      {t("analytics.lastFetch")}: {src.last_fetch ? fmtDateTime(src.last_fetch) : "--"}
                    </span>
                    <span>{t("analytics.runs")}: {src.total_runs}</span>
                    {src.error_count > 0 && (
                      <span className="text-red-500">
                        {t("analytics.errors24h")}: {src.error_count}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────── */

function getInitialTab(): AnalyticsTab {
  if (typeof window === "undefined") return "trends";
  const hash = window.location.hash.replace("#", "");
  const validTabs: AnalyticsTab[] = ["trends", "scores", "ingestion"];
  return validTabs.includes(hash as AnalyticsTab) ? (hash as AnalyticsTab) : "trends";
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(getInitialTab);

  const handleTabChange = useCallback((tab: AnalyticsTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab}`);
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {t("analytics.title")}
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          {t("analytics.description")}
        </p>
      </div>

      {/* Tab navigation */}
      <nav
        className="flex gap-1 rounded-lg bg-[var(--bg-secondary)] p-1"
        role="tablist"
        aria-label="Analytics sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => handleTabChange(tab.id)}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all",
              "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
              activeTab === tab.id
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
          >
            <span className={clsx(
              activeTab === tab.id ? "text-radar-600" : "text-[var(--text-tertiary)]"
            )}>
              {tab.icon}
            </span>
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </nav>

      {/* Tab description */}
      <p className="text-sm text-[var(--text-tertiary)]">
        {(() => {
          const tab = TABS.find((tb) => tb.id === activeTab);
          return tab ? t(tab.descriptionKey) : "";
        })()}
      </p>

      {/* Tab panels */}
      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="animate-fade-in"
      >
        {activeTab === "trends" && <TrendsPanel />}
        {activeTab === "scores" && <ScoresPanel />}
        {activeTab === "ingestion" && <IngestionPanel />}
      </div>
    </div>
  );
}
