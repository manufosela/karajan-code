"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/signals/ScoreBadge";
import { StatusBadge } from "@/components/signals/StatusBadge";
import { SignalFilters } from "@/components/signals/SignalFilters";
import { fetchSignals, updateSignalStatus } from "@/lib/api";
import { formatDate, truncate } from "@/lib/utils";
import type {
  Signal,
  SignalFilters as SignalFiltersType,
  ReviewStatus,
  PaginatedResponse,
} from "@/types/signal";

/* ─── Status Labels ──────────────────────────────────────── */

const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "relevant", label: "Relevant" },
  { value: "review", label: "Review" },
  { value: "discarded", label: "Discarded" },
  { value: "opportunity", label: "Opportunity" },
  { value: "follow_up", label: "Follow Up" },
];

/* ─── Sort Config ────────────────────────────────────────── */

type SortField =
  | "original_title"
  | "journal_or_origin"
  | "scientific_strength_score"
  | "strategic_relevance_score"
  | "review_status"
  | "strategic_buckets"
  | "publication_date";

interface SortConfig {
  field: SortField;
  order: "asc" | "desc";
}

const COLUMN_HEADERS: { field: SortField; labelKey: "table.title" | "table.source" | "table.scientific" | "table.strategic" | "table.status" | "table.bucket" | "table.date"; className?: string }[] = [
  { field: "original_title", labelKey: "table.title" },
  { field: "journal_or_origin", labelKey: "table.source" },
  { field: "scientific_strength_score", labelKey: "table.scientific", className: "text-center" },
  { field: "strategic_relevance_score", labelKey: "table.strategic", className: "text-center" },
  { field: "review_status", labelKey: "table.status" },
  { field: "strategic_buckets", labelKey: "table.bucket" },
  { field: "publication_date", labelKey: "table.date" },
];

/* ─── (Mock data removed - using API only) ──────────────── */

/* ─── Toast Component ────────────────────────────────────── */

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "animate-slide-up flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          )}
          role="alert"
        >
          {toast.type === "success" ? (
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          )}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="ml-2 hover:opacity-80 transition-opacity"
            aria-label="Dismiss notification"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── Sort Arrow ─────────────────────────────────────────── */

function SortArrow({ field, sort }: { field: SortField; sort: SortConfig }) {
  if (sort.field !== field) {
    return (
      <svg className="ml-1 inline h-3 w-3 opacity-30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
      </svg>
    );
  }

  return sort.order === "asc" ? (
    <svg className="ml-1 inline h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  ) : (
    <svg className="ml-1 inline h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

/* ─── Page Component ─────────────────────────────────────── */

function SignalsPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  /* State */
  const [signals, setSignals] = useState<Signal[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  /* Parse URL search params into filters */
  const filters = useMemo<SignalFiltersType>(() => {
    const f: SignalFiltersType = {};
    const search = searchParams.get("search");
    if (search) f.search = search;

    const dateFrom = searchParams.get("date_from");
    if (dateFrom) f.date_from = dateFrom;

    const dateTo = searchParams.get("date_to");
    if (dateTo) f.date_to = dateTo;

    const sourceId = searchParams.get("source_id");
    if (sourceId) f.source_id = sourceId;

    const minSci = searchParams.get("min_scientific_score");
    if (minSci) f.min_scientific_score = parseFloat(minSci);

    const minStr = searchParams.get("min_strategic_score");
    if (minStr) f.min_strategic_score = parseFloat(minStr);

    const status = searchParams.get("review_status");
    if (status) f.review_status = status;

    const bucket = searchParams.get("bucket");
    if (bucket) f.bucket = bucket;

    const docType = searchParams.get("document_type");
    if (docType) f.document_type = docType;

    return f;
  }, [searchParams]);

  /* Pagination from URL */
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(searchParams.get("page_size") ?? "20", 10);

  /* Sort from URL */
  const sort: SortConfig = useMemo(
    () => ({
      field: (searchParams.get("sort_by") as SortField) || "publication_date",
      order: (searchParams.get("sort_order") as "asc" | "desc") || "desc",
    }),
    [searchParams]
  );

  /* Helpers to update URL */
  const updateSearchParams = useCallback(
    (updates: Record<string, string | string[] | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(key, v);
          }
        } else {
          params.set(key, value);
        }
      }

      router.push(`/signals?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  /* Filter change handler - resets to page 1 */
  const handleFiltersChange = useCallback(
    (newFilters: SignalFiltersType) => {
      const params: Record<string, string | string[] | undefined> = {
        page: "1",
        search: newFilters.search,
        date_from: newFilters.date_from,
        date_to: newFilters.date_to,
        source_id: newFilters.source_id,
        min_scientific_score: newFilters.min_scientific_score?.toString(),
        min_strategic_score: newFilters.min_strategic_score?.toString(),
        review_status: newFilters.review_status,
        bucket: newFilters.bucket,
        document_type: newFilters.document_type,
      };
      updateSearchParams(params);
    },
    [updateSearchParams]
  );

  /* Sort handler */
  const handleSort = useCallback(
    (field: SortField) => {
      const newOrder =
        sort.field === field && sort.order === "asc" ? "desc" : "asc";
      updateSearchParams({ sort_by: field, sort_order: newOrder });
    },
    [sort, updateSearchParams]
  );

  /* Page size handler */
  const handlePageSizeChange = useCallback(
    (newSize: number) => {
      updateSearchParams({ page: "1", page_size: newSize.toString() });
    },
    [updateSearchParams]
  );

  /* Toast helpers */
  const addToast = useCallback((message: string, type: "success" | "error") => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* Status change handler (optimistic) */
  const handleStatusChange = useCallback(
    async (signalId: string, newStatus: ReviewStatus) => {
      const previousSignals = [...signals];
      const signalIndex = signals.findIndex((s) => s.id === signalId);
      if (signalIndex === -1) return;

      /* Optimistic update */
      setSignals((prev) =>
        prev.map((s) =>
          s.id === signalId ? { ...s, review_status: newStatus } : s
        )
      );

      try {
        await updateSignalStatus(signalId, newStatus);
        addToast(
          `${t("detail.statusUpdated")} "${STATUS_OPTIONS.find((o) => o.value === newStatus)?.label}"`,
          "success"
        );
      } catch {
        /* Rollback */
        setSignals(previousSignals);
        addToast(t("detail.statusUpdateError"), "error");
      }
    },
    [signals, addToast, t]
  );

  /* Processed data from API response */
  const processedData = useMemo((): PaginatedResponse<Signal> => {
    return {
      items: signals,
      total: totalCount,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(totalCount / pageSize)),
    };
  }, [signals, page, pageSize, totalCount]);

  /* Fetch data */
  useEffect(() => {
    let cancelled = false;

    async function loadSignals() {
      setIsLoading(true);
      try {
        const result = await fetchSignals(filters, {
          page,
          page_size: pageSize,
          sort_by: sort.field,
          sort_order: sort.order,
        });
        if (!cancelled) {
          setSignals(result.items);
          setTotalCount(result.total);
          setHasError(false);
        }
      } catch {
        if (!cancelled) {
          setSignals([]);
          setTotalCount(0);
          setHasError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSignals();
    return () => {
      cancelled = true;
    };
  }, [filters, page, pageSize, sort.field, sort.order]);

  /* Computed */
  const totalPages = processedData.total_pages;
  const displayItems = processedData.items;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t("signals.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {hasError
              ? t("signals.noResults")
              : `${processedData.total} ${t("signals.found")}`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <SignalFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        isOpen={filtersOpen}
        onToggle={() => setFiltersOpen((prev) => !prev)}
      />

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-500 border-t-transparent" />
          <span className="ml-3 text-sm text-[var(--text-secondary)]">
            {t("signals.loading")}
          </span>
        </div>
      )}

      {/* Error State */}
      {!isLoading && hasError && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <svg className="h-12 w-12 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
              {t("signals.noResults")}
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Check that the backend is running.
            </p>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !hasError && processedData.total === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <svg className="h-12 w-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
              No signals found
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Run an ingestion job to capture research signals.
            </p>
          </div>
        </Card>
      )}

      {/* Table (Desktop) */}
      {!isLoading && !hasError && processedData.total > 0 && (
        <>
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-primary)]">
                    {COLUMN_HEADERS.map((col) => (
                      <th
                        key={col.field}
                        className={clsx(
                          "px-4 py-3 font-medium text-[var(--text-secondary)] cursor-pointer select-none",
                          "hover:text-[var(--text-primary)] transition-colors",
                          col.className
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.field)}
                          className="inline-flex items-center gap-0.5 focus:outline-none focus:underline"
                          aria-label={`Sort by ${t(col.labelKey)}`}
                        >
                          {t(col.labelKey)}
                          <SortArrow field={col.field} sort={sort} />
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium text-[var(--text-secondary)]">
                      {t("table.action")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-[var(--text-tertiary)]"
                      >
                        {t("signals.noResults")}
                      </td>
                    </tr>
                  )}
                  {displayItems.map((signal) => (
                    <tr
                      key={signal.id}
                      className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                      onClick={() => router.push(`/signals/${signal.id}`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/signals/${signal.id}`);
                        }
                      }}
                      aria-label={`View signal: ${signal.original_title}`}
                    >
                      <td className="px-4 py-3 max-w-xs">
                        <Link
                          href={`/signals/${signal.id}`}
                          className="font-medium text-[var(--text-primary)] hover:text-radar-600 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {truncate(signal.original_title, 60)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">
                        {signal.journal_or_origin ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {signal.scientific_strength_score != null ? (
                          <ScoreBadge score={signal.scientific_strength_score} />
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {signal.strategic_relevance_score != null ? (
                          <ScoreBadge score={signal.strategic_relevance_score} />
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={signal.review_status} />
                      </td>
                      <td className="px-4 py-3">
                        {signal.strategic_buckets?.[0] ? (
                          <Badge variant="bucket" bucket={signal.strategic_buckets[0]}>
                            {signal.strategic_buckets[0]}
                          </Badge>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-tertiary)] whitespace-nowrap">
                        {formatDate(signal.publication_date)}
                      </td>
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={signal.review_status}
                          onChange={(e) =>
                            handleStatusChange(
                              signal.id,
                              e.target.value as ReviewStatus
                            )
                          }
                          className="input py-1 text-xs min-w-[110px]"
                          aria-label={`Change status for ${signal.original_title}`}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Cards (Mobile) */}
          <div className="flex flex-col gap-4 md:hidden">
            {displayItems.length === 0 && (
              <p className="py-12 text-center text-[var(--text-tertiary)]">
                No se encontraron senales con los filtros actuales.
              </p>
            )}
            {displayItems.map((signal) => (
              <Link key={signal.id} href={`/signals/${signal.id}`}>
                <Card className="hover:shadow-md transition-shadow">
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-[var(--text-primary)] text-sm leading-tight">
                        {signal.original_title}
                      </h3>
                      {signal.strategic_buckets?.[0] ? (
                        <Badge
                          variant="bucket"
                          bucket={signal.strategic_buckets[0]}
                          className="flex-shrink-0"
                        >
                          {signal.strategic_buckets[0]}
                        </Badge>
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">—</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span>{signal.journal_or_origin ?? "—"}</span>
                      <span className="text-[var(--text-tertiary)]">|</span>
                      <span>{formatDate(signal.publication_date)}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {signal.scientific_strength_score != null ? (
                        <ScoreBadge score={signal.scientific_strength_score} label="Sci" size="sm" />
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)]">Sci: —</span>
                      )}
                      {signal.strategic_relevance_score != null ? (
                        <ScoreBadge score={signal.strategic_relevance_score} label="Str" size="sm" />
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)]">Str: —</span>
                      )}
                      <div className="ml-auto">
                        <StatusBadge status={signal.review_status} />
                      </div>
                    </div>

                    <div onClick={(e) => e.preventDefault()}>
                      <select
                        value={signal.review_status}
                        onChange={(e) => {
                          e.preventDefault();
                          handleStatusChange(
                            signal.id,
                            e.target.value as ReviewStatus
                          );
                        }}
                        className="input w-full py-1 text-xs"
                        aria-label={`Change status for ${signal.original_title}`}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <label htmlFor="page-size-select">{t("pagination.show")}</label>
              <select
                id="page-size-select"
                value={pageSize}
                onChange={(e) =>
                  handlePageSizeChange(parseInt(e.target.value, 10))
                }
                className="input py-1 text-xs"
                aria-label="Page size"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>{t("pagination.perPage")}</span>
            </div>

            {/* Page Info & Navigation */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-tertiary)]">
                {t("pagination.page")} {page} {t("pagination.of")} {totalPages}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    updateSearchParams({ page: (page - 1).toString() })
                  }
                  disabled={page <= 1}
                  className={clsx(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
                    page <= 1
                      ? "cursor-not-allowed border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                      : "border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  )}
                  aria-label="Previous page"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateSearchParams({ page: (page + 1).toString() })
                  }
                  disabled={page >= totalPages}
                  className={clsx(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
                    page >= totalPages
                      ? "cursor-not-allowed border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                      : "border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  )}
                  aria-label="Next page"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function SignalsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse p-8 text-[var(--text-tertiary)]">Loading...</div>}>
      <SignalsPageContent />
    </Suspense>
  );
}
