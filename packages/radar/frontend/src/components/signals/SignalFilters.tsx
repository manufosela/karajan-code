"use client";

import { useCallback } from "react";
import clsx from "clsx";
import type {
  SignalFilters as SignalFiltersType,
  ReviewStatus,
} from "@/types/signal";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/signals/StatusBadge";

/* ─── Constants ──────────────────────────────────────────── */

const REVIEW_STATUSES: ReviewStatus[] = [
  "pending",
  "relevant",
  "review",
  "discarded",
  "opportunity",
  "follow_up",
];

const STRATEGIC_BUCKETS: string[] = [
  "adopt",
  "trial",
  "assess",
  "hold",
  "monitor",
  "innovate",
];

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: "journal_article", label: "Journal Article" },
  { value: "conference_paper", label: "Conference Paper" },
  { value: "patent", label: "Patent" },
  { value: "clinical_trial", label: "Clinical Trial" },
  { value: "preprint", label: "Preprint" },
  { value: "review_article", label: "Review Article" },
  { value: "case_report", label: "Case Report" },
  { value: "thesis", label: "Thesis" },
  { value: "technical_report", label: "Technical Report" },
  { value: "news", label: "News" },
  { value: "blog_post", label: "Blog Post" },
  { value: "other", label: "Other" },
];

const SOURCES = [
  { value: "pubmed", label: "PubMed" },
  { value: "ieee", label: "IEEE Xplore" },
  { value: "nature", label: "Nature Biomedical" },
  { value: "dental_materials", label: "Dental Materials" },
  { value: "jada", label: "JADA" },
  { value: "arxiv", label: "arXiv" },
];

/* ─── Props ──────────────────────────────────────────────── */

interface SignalFiltersProps {
  filters: SignalFiltersType;
  onFiltersChange: (filters: SignalFiltersType) => void;
  isOpen: boolean;
  onToggle: () => void;
}

/* ─── Helpers ────────────────────────────────────────────── */

function countActiveFilters(filters: SignalFiltersType): number {
  let count = 0;
  if (filters.search) count++;
  if (filters.date_from) count++;
  if (filters.date_to) count++;
  if (filters.source_id) count++;
  if (filters.min_scientific_score !== undefined) count++;
  if (filters.min_strategic_score !== undefined) count++;
  if (filters.review_status) count++;
  if (filters.bucket) count++;
  if (filters.document_type) count++;

  return count;
}

/* ─── Checkbox Group ─────────────────────────────────────── */

interface CheckboxGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (selected: T[]) => void;
  renderOption?: (option: { value: T; label: string }) => React.ReactNode;
}

function CheckboxGroup<T extends string>({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: CheckboxGroupProps<T>) {
  const handleToggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleToggle(opt.value)}
              className={clsx(
                "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
                isSelected
                  ? "border-radar-500 bg-radar-50 text-radar-700 dark:bg-radar-900/20 dark:text-radar-400"
                  : "border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
              )}
              aria-pressed={isSelected}
              aria-label={`Filter by ${opt.label}`}
            >
              {renderOption ? renderOption(opt) : opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────── */

export function SignalFilters({
  filters,
  onFiltersChange,
  isOpen,
  onToggle,
}: SignalFiltersProps) {
  const activeCount = countActiveFilters(filters);

  const updateFilter = useCallback(
    <K extends keyof SignalFiltersType>(
      key: K,
      value: SignalFiltersType[K]
    ) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange]
  );

  const clearAllFilters = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const selectedStatuses = filters.review_status ? [filters.review_status] : [];
  const selectedBuckets = filters.bucket ? [filters.bucket] : [];
  const selectedDocTypes = filters.document_type ? [filters.document_type] : [];
  const selectedSources = filters.source_id ? [filters.source_id] : [];

  return (
    <div>
      {/* Toggle Button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={clsx(
            "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all",
            "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
            isOpen
              ? "border-radar-500 bg-radar-50 text-radar-700 dark:bg-radar-900/20 dark:text-radar-400"
              : "border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          )}
          aria-expanded={isOpen}
          aria-controls="signal-filters-panel"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
            />
          </svg>
          Filtros
          {activeCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-radar-600 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors focus:outline-none focus:underline"
            aria-label="Clear all filters"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Filter Panel */}
      {isOpen && (
        <div
          id="signal-filters-panel"
          className="mt-4 animate-slide-up rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-6"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {/* Text Search */}
            <div className="md:col-span-2 xl:col-span-3">
              <label
                htmlFor="signal-search"
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
              >
                Buscar
              </label>
              <input
                id="signal-search"
                type="text"
                value={filters.search ?? ""}
                onChange={(e) => updateFilter("search", e.target.value || undefined)}
                placeholder="Buscar por titulo, abstract, keywords..."
                className="input w-full"
                aria-label="Search signals"
              />
            </div>

            {/* Date From */}
            <div>
              <label
                htmlFor="date-from"
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
              >
                Fecha desde
              </label>
              <input
                id="date-from"
                type="date"
                value={filters.date_from ?? ""}
                onChange={(e) =>
                  updateFilter("date_from", e.target.value || undefined)
                }
                className="input w-full"
                aria-label="Filter from date"
              />
            </div>

            {/* Date To */}
            <div>
              <label
                htmlFor="date-to"
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
              >
                Fecha hasta
              </label>
              <input
                id="date-to"
                type="date"
                value={filters.date_to ?? ""}
                onChange={(e) =>
                  updateFilter("date_to", e.target.value || undefined)
                }
                className="input w-full"
                aria-label="Filter to date"
              />
            </div>

            {/* Source */}
            <div>
              <CheckboxGroup
                label="Fuente"
                options={SOURCES}
                selected={selectedSources}
                onChange={(vals) =>
                  updateFilter("source_id", vals.length > 0 ? vals[0] : undefined)
                }
              />
            </div>

            {/* Document Type */}
            <div className="md:col-span-2 xl:col-span-3">
              <CheckboxGroup
                label="Tipo de documento"
                options={DOCUMENT_TYPES}
                selected={selectedDocTypes}
                onChange={(vals) =>
                  updateFilter(
                    "document_type",
                    vals.length > 0 ? vals[vals.length - 1] : undefined
                  )
                }
              />
            </div>

            {/* Strategic Bucket */}
            <div className="md:col-span-2 xl:col-span-3">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Bucket estrategico
              </label>
              <div className="flex flex-wrap gap-2">
                {STRATEGIC_BUCKETS.map((bucket) => {
                  const isSelected = selectedBuckets.includes(bucket);
                  return (
                    <button
                      key={bucket}
                      type="button"
                      onClick={() => {
                        updateFilter(
                          "bucket",
                          isSelected ? undefined : bucket
                        );
                      }}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                        "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
                        isSelected
                          ? "border-radar-500 bg-radar-50 text-radar-700 dark:bg-radar-900/20 dark:text-radar-400"
                          : "border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)]"
                      )}
                      aria-pressed={isSelected}
                      aria-label={`Filter by bucket ${bucket}`}
                    >
                      <Badge variant="bucket" bucket={bucket} className="pointer-events-none">
                        {bucket}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Score Minimums */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Score cientifico minimo
              </label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={filters.min_scientific_score ?? ""}
                onChange={(e) =>
                  updateFilter(
                    "min_scientific_score",
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="Min"
                className="input w-24"
                aria-label="Minimum scientific score"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Score estrategico minimo
              </label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={filters.min_strategic_score ?? ""}
                onChange={(e) =>
                  updateFilter(
                    "min_strategic_score",
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="Min"
                className="input w-24"
                aria-label="Minimum strategic score"
              />
            </div>

            {/* Review Status */}
            <div className="md:col-span-2 xl:col-span-3">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Estado de revision
              </label>
              <div className="flex flex-wrap gap-2">
                {REVIEW_STATUSES.map((status) => {
                  const isSelected = selectedStatuses.includes(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        updateFilter(
                          "review_status",
                          isSelected ? undefined : status
                        );
                      }}
                      className={clsx(
                        "rounded-full transition-all",
                        "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
                        isSelected
                          ? "ring-2 ring-radar-500 ring-offset-1"
                          : "opacity-60 hover:opacity-100"
                      )}
                      aria-pressed={isSelected}
                      aria-label={`Filter by status ${status}`}
                    >
                      <StatusBadge status={status} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
