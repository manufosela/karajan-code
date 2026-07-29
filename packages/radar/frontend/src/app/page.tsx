"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { ScoreBadge } from "@/components/signals/ScoreBadge";
import { StatusBadge } from "@/components/signals/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { fetchSignals, fetchSources } from "@/lib/api";
import type { Signal } from "@/types/signal";

interface DashboardStats {
  totalSignals: number;
  pendingReview: number;
  highRelevance: number;
  activeSources: number;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalSignals: 0,
    pendingReview: 0,
    highRelevance: 0,
    activeSources: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      setIsLoading(true);
      setHasError(false);

      try {
        const [signalsResult, sourcesResult] = await Promise.allSettled([
          fetchSignals({}, { page: 1, page_size: 5, sort_by: "publication_date", sort_order: "desc" }),
          fetchSources(),
        ]);

        if (cancelled) return;

        if (signalsResult.status === "rejected" && sourcesResult.status === "rejected") {
          setHasError(true);
          return;
        }

        const signalsData = signalsResult.status === "fulfilled" ? signalsResult.value : null;
        const sourcesData = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];

        if (signalsData) {
          setSignals(signalsData.items);
          setStats({
            totalSignals: signalsData.total,
            pendingReview: 0,
            highRelevance: 0,
            activeSources: sourcesData.filter((s) => s.enabled).length,
          });

          /* Fetch counts for pending-review and high-relevance signals */
          const [pendingResult, relevantResult] = await Promise.allSettled([
            fetchSignals({ review_status: "review" }, { page: 1, page_size: 1 }),
            fetchSignals({ min_scientific_score: 7.0 }, { page: 1, page_size: 1 }),
          ]);

          if (!cancelled) {
            setStats((prev) => ({
              ...prev,
              pendingReview: pendingResult.status === "fulfilled" ? pendingResult.value.total : 0,
              highRelevance: relevantResult.status === "fulfilled" ? relevantResult.value.total : 0,
            }));
          }
        } else {
          setHasError(true);
        }
      } catch {
        if (!cancelled) {
          setHasError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDashboardData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="animate-fade-in radar-bg min-h-full">
      {/* Hero section - asymmetric layout */}
      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-radar-600 mb-2">
            {t("dashboard.briefingLabel")}
          </p>
          <h1 className="text-4xl lg:text-5xl font-display text-[var(--text-primary)] leading-[1.1]">
            {t("dashboard.title")}<br />
            <span className="text-radar-600">{t("dashboard.subtitle")}</span>
          </h1>
          <p className="mt-3 text-[var(--text-secondary)] max-w-lg">
            {t("dashboard.description")}
          </p>
        </div>

        {/* Key metrics - horizontal strip, not cards */}
        <div className="flex gap-8 lg:gap-10">
          <div className="stat-accent pl-4" style={{ "--accent-color": "#338bff" } as React.CSSProperties}>
            {isLoading ? (
              <div className="h-9 w-16 animate-pulse rounded bg-[var(--bg-tertiary)]" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
                {hasError ? "--" : stats.totalSignals.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t("dashboard.totalSignals")}</p>
          </div>
          <div className="stat-accent pl-4" style={{ "--accent-color": "#f59e0b" } as React.CSSProperties}>
            {isLoading ? (
              <div className="h-9 w-12 animate-pulse rounded bg-[var(--bg-tertiary)]" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
                {hasError ? "--" : stats.pendingReview.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t("dashboard.pendingReview")}</p>
          </div>
          <div className="stat-accent pl-4" style={{ "--accent-color": "#10b981" } as React.CSSProperties}>
            {isLoading ? (
              <div className="h-9 w-12 animate-pulse rounded bg-[var(--bg-tertiary)]" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
                {hasError ? "--" : stats.highRelevance.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t("dashboard.highRelevance")}</p>
          </div>
          <div className="stat-accent pl-4 hidden sm:block" style={{ "--accent-color": "#07c6b1" } as React.CSSProperties}>
            {isLoading ? (
              <div className="h-9 w-12 animate-pulse rounded bg-[var(--bg-tertiary)]" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
                {hasError ? "--" : stats.activeSources.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t("dashboard.activeSources")}</p>
          </div>
        </div>
      </div>

      {/* Divider with radar accent */}
      <div className="mb-8 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-primary)]" />
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          <svg className="h-3.5 w-3.5 text-radar-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546" />
          </svg>
          {t("dashboard.recentSignals")}
        </div>
        <div className="h-px flex-1 bg-[var(--border-primary)]" />
      </div>

      {/* Recent Signals - cleaner table */}
      <div className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-sm text-[var(--text-secondary)]">
            {t("dashboard.recentDescription")}
          </p>
          <Link
            href="/signals"
            className="text-sm font-medium text-radar-600 hover:text-radar-700 transition-colors"
          >
            {t("dashboard.viewAll")} &rarr;
          </Link>
        </div>

        {/* Loading State */}
        {isLoading && (
          <Card>
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-[var(--border-primary)] last:border-0 px-5 py-4"
                >
                  <div className="h-4 w-2/5 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-10 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-10 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-tertiary)]" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Error State */}
        {!isLoading && hasError && (
          <Card>
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <svg className="h-12 w-12 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
                Unable to connect to the API
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Check backend configuration.
              </p>
            </div>
          </Card>
        )}

        {/* Empty State */}
        {!isLoading && !hasError && signals.length === 0 && (
          <Card>
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <svg className="h-12 w-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
                No signals captured yet
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Configure sources and run the first ingestion.
              </p>
            </div>
          </Card>
        )}

        {/* Signals Table */}
        {!isLoading && !hasError && signals.length > 0 && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-primary)]">
                    <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {t("table.title")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {t("table.source")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] text-center">
                      {t("table.scientific")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] text-center">
                      {t("table.strategic")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {t("table.status")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {t("table.bucket")}
                    </th>
                    <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {t("table.date")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((signal, idx) => (
                    <tr
                      key={signal.id}
                      className="border-b border-[var(--border-primary)] last:border-0 table-row-hover"
                      style={{ animationDelay: `${idx * 60}ms` }}
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/signals/${signal.id}`}
                          className="font-medium text-[var(--text-primary)] hover:text-radar-600 transition-colors leading-snug"
                        >
                          {signal.original_title}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[var(--text-secondary)] text-xs font-medium px-2 py-1 rounded bg-[var(--bg-tertiary)]">
                          {signal.journal_or_origin ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {signal.scientific_strength_score != null ? (
                          <ScoreBadge score={signal.scientific_strength_score} />
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {signal.strategic_relevance_score != null ? (
                          <ScoreBadge score={signal.strategic_relevance_score} />
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={signal.review_status} />
                      </td>
                      <td className="px-4 py-3.5">
                        {signal.strategic_buckets?.[0] ? (
                          <Badge variant="bucket" bucket={signal.strategic_buckets[0]}>
                            {signal.strategic_buckets[0]}
                          </Badge>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[var(--text-tertiary)] tabular-nums text-xs">
                        {signal.publication_date ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Bottom navigation - more refined */}
      <div className="grid grid-cols-1 gap-px md:grid-cols-2 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--border-primary)]">
        <Link
          href="/signals"
          className="flex items-center gap-4 bg-[var(--bg-card)] p-6 transition-colors hover:bg-[var(--bg-secondary)] group"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-radar-50 dark:bg-radar-900/20 transition-colors group-hover:bg-radar-100 dark:group-hover:bg-radar-900/30">
            <svg
              className="h-5 w-5 text-radar-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[var(--text-primary)] font-display text-base">
              {t("dashboard.exploreSignals")}
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("dashboard.exploreDescription")}
            </p>
          </div>
          <svg className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>

        <Link
          href="/configuration"
          className="flex items-center gap-4 bg-[var(--bg-card)] p-6 transition-colors hover:bg-[var(--bg-secondary)] group"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-900/20 transition-colors group-hover:bg-teal-100 dark:group-hover:bg-teal-900/30">
            <svg
              className="h-5 w-5 text-teal-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[var(--text-primary)] font-display text-base">
              {t("dashboard.configuration")}
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("dashboard.configDescription")}
            </p>
          </div>
          <svg className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
