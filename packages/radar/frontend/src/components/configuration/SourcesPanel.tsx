"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useTranslation } from "@/lib/i18n";
import { fetchSources, updateSource, triggerSourceFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Source, SourceUpdatePayload } from "@/types/source";
import clsx from "clsx";

/* ─── Constants ──────────────────────────────────────────── */

const TYPE_LABELS: Record<string, string> = {
  api: "API",
  scraper: "Scraper",
  rss: "RSS",
  manual: "Manual",
  pubmed: "PubMed",
  arxiv: "arXiv",
  clinical_trials: "Clinical Trials",
};

/** Config keys that should be hidden from the detail view */
const HIDDEN_CONFIG_KEYS = new Set([
  "api_key_env",
  "api_key",
  "db",
  "database",
  "rate_limit_per_second",
  "rate_limit",
  "timeout",
  "retry_count",
  "retry_delay",
  "headers",
  "auth",
  "credentials",
]);

interface ToastState {
  message: string;
  type: "success" | "error";
  visible: boolean;
}

interface EditState {
  priority: number;
  baseUrl: string;
  queryTerms: string[];
  maxResults: number;
}

/**
 * Extract search query terms from source config.
 * Looks for common config keys that store search terms.
 */
function extractQueryTerms(config: Record<string, unknown>): string[] {
  const possibleKeys = ["query_terms", "search_terms", "queries", "keywords", "terms"];
  for (const key of possibleKeys) {
    const value = config[key];
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Extract max_results from source config.
 */
function extractMaxResults(config: Record<string, unknown>): number {
  const value = config["max_results"] ?? config["maxResults"] ?? config["limit"];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Extract fetch interval from source config (for display only).
 */
function extractFetchInterval(config: Record<string, unknown>): string | null {
  const value = config["fetch_interval"] ?? config["interval"] ?? config["schedule"];
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number") return `${value}s`;
  return null;
}

export function SourcesPanel() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [newQueryInput, setNewQueryInput] = useState("");
  const [toast, setToast] = useState<ToastState>({ message: "", type: "success", visible: false });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      try {
        const data = await fetchSources();
        if (mounted) {
          setSources(data);
          setHasError(false);
        }
      } catch {
        if (mounted) {
          setSources([]);
          setHasError(true);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadSources();
    return () => { mounted = false; };
  }, []);

  const handleToggleEnabled = useCallback(async (source: Source) => {
    const newEnabled = !source.enabled;
    setTogglingIds((prev) => new Set(prev).add(source.id));
    try {
      const updated = await updateSource(source.id, { enabled: newEnabled });
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      showToast(`${source.name} ${newEnabled ? "enabled" : "disabled"}`, "success");
    } catch {
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id ? { ...s, enabled: newEnabled } : s
        )
      );
      showToast(`${source.name} ${newEnabled ? "enabled" : "disabled"} (offline mode)`, "success");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  }, [showToast]);

  const handleTriggerFetch = useCallback(async (source: Source) => {
    setFetchingIds((prev) => new Set(prev).add(source.id));
    try {
      await triggerSourceFetch(source.id);
      showToast(`Fetch triggered for ${source.name}`, "success");
    } catch {
      showToast(`Failed to trigger fetch for ${source.name}`, "error");
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  }, [showToast]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleStartEdit = useCallback((source: Source) => {
    setEditingId(source.id);
    setExpandedId(source.id);
    setEditState({
      priority: source.priority,
      baseUrl: source.base_url ?? "",
      queryTerms: extractQueryTerms(source.config),
      maxResults: extractMaxResults(source.config),
    });
    setNewQueryInput("");
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditState(null);
    setNewQueryInput("");
  }, []);

  const handleSaveEdit = useCallback(async (source: Source) => {
    if (!editState) return;

    setSavingId(source.id);
    try {
      const payload: SourceUpdatePayload = {
        priority: editState.priority,
        base_url: editState.baseUrl || undefined,
        query_terms: editState.queryTerms.length > 0 ? editState.queryTerms : undefined,
        max_results: editState.maxResults > 0 ? editState.maxResults : undefined,
      };

      const updated = await updateSource(source.id, payload);
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      showToast(t("sources.saveSuccess"), "success");
      setEditingId(null);
      setEditState(null);
      setNewQueryInput("");
    } catch {
      showToast(t("sources.saveError"), "error");
    } finally {
      setSavingId(null);
    }
  }, [editState, showToast, t]);

  const handleAddQuery = useCallback(() => {
    if (!editState || !newQueryInput.trim()) return;
    setEditState((prev) =>
      prev ? { ...prev, queryTerms: [...prev.queryTerms, newQueryInput.trim()] } : prev
    );
    setNewQueryInput("");
  }, [editState, newQueryInput]);

  const handleRemoveQuery = useCallback((index: number) => {
    setEditState((prev) =>
      prev ? { ...prev, queryTerms: prev.queryTerms.filter((_, i) => i !== index) } : prev
    );
  }, []);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
            <span className="ml-3 text-[var(--text-secondary)]">{t("common.loading")}</span>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (hasError) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="h-12 w-12 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">Unable to load sources</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Check that the backend is running.</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (sources.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="h-12 w-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">No sources configured</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Add data sources to start capturing research signals.</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast notification */}
      {toast.visible && (
        <div
          className={clsx(
            "fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-slide-up",
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          )}
          role="alert"
        >
          {toast.message}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="text-center">
            <p className="text-2xl font-bold text-[var(--text-primary)]">{sources.length}</p>
            <p className="text-xs text-[var(--text-secondary)]">{t("sources.totalSources")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="text-center">
            <p className="text-2xl font-bold text-emerald-600">
              {sources.filter((s) => s.enabled).length}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">{t("sources.active")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="text-center">
            <p className="text-2xl font-bold text-gray-500">
              {sources.filter((s) => !s.enabled).length}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">{t("sources.disabled")}</p>
          </CardBody>
        </Card>
      </div>

      {/* Sources table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("sources.title")}</h2>
            <span className="text-sm text-[var(--text-tertiary)]">
              {sources.filter((s) => s.enabled).length} / {sources.length} {t("common.enabled").toLowerCase()}
            </span>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-primary)]">
                <th className="px-6 py-3 font-medium text-[var(--text-secondary)]">{t("table.title")}</th>
                <th className="px-6 py-3 font-medium text-[var(--text-secondary)]">{t("table.type")}</th>
                <th className="px-6 py-3 font-medium text-[var(--text-secondary)]">{t("common.enabled")}</th>
                <th className="px-6 py-3 font-medium text-[var(--text-secondary)]">{t("table.lastFetched")}</th>
                <th className="px-6 py-3 font-medium text-[var(--text-secondary)]">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => {
                const expanded = expandedId === source.id;
                const isEditing = editingId === source.id;
                const isFetching = fetchingIds.has(source.id);
                const isToggling = togglingIds.has(source.id);
                const isSaving = savingId === source.id;

                return (
                  <SourceRow
                    key={source.id}
                    source={source}
                    expanded={expanded}
                    isEditing={isEditing}
                    editState={isEditing ? editState : null}
                    isFetching={isFetching}
                    isToggling={isToggling}
                    isSaving={isSaving}
                    newQueryInput={isEditing ? newQueryInput : ""}
                    onToggleExpand={handleToggleExpand}
                    onToggleEnabled={handleToggleEnabled}
                    onTriggerFetch={handleTriggerFetch}
                    onStartEdit={handleStartEdit}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={handleSaveEdit}
                    onEditStateChange={setEditState}
                    onNewQueryInputChange={setNewQueryInput}
                    onAddQuery={handleAddQuery}
                    onRemoveQuery={handleRemoveQuery}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ─── SourceRow ─────────────────────────────────────────── */

interface SourceRowProps {
  source: Source;
  expanded: boolean;
  isEditing: boolean;
  editState: EditState | null;
  isFetching: boolean;
  isToggling: boolean;
  isSaving: boolean;
  newQueryInput: string;
  onToggleExpand: (id: string) => void;
  onToggleEnabled: (source: Source) => void;
  onTriggerFetch: (source: Source) => void;
  onStartEdit: (source: Source) => void;
  onCancelEdit: () => void;
  onSaveEdit: (source: Source) => void;
  onEditStateChange: React.Dispatch<React.SetStateAction<EditState | null>>;
  onNewQueryInputChange: (value: string) => void;
  onAddQuery: () => void;
  onRemoveQuery: (index: number) => void;
}

function SourceRow({
  source,
  expanded,
  isEditing,
  editState,
  isFetching,
  isToggling,
  isSaving,
  newQueryInput,
  onToggleExpand,
  onToggleEnabled,
  onTriggerFetch,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditStateChange,
  onNewQueryInputChange,
  onAddQuery,
  onRemoveQuery,
}: SourceRowProps) {
  const { t } = useTranslation();

  const lastFetchedText = source.last_fetched_at
    ? formatDate(source.last_fetched_at, "d MMM, HH:mm")
    : t("sources.never");

  return (
    <>
      <tr
        className={clsx(
          "border-b border-[var(--border-primary)] transition-colors cursor-pointer",
          expanded ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-tertiary)]"
        )}
        onClick={() => onToggleExpand(source.id)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${source.name} details`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand(source.id);
          }
        }}
      >
        {/* Source name with description */}
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <svg
              className={clsx(
                "h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform",
                expanded && "rotate-90"
              )}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <div>
              <p className="font-medium text-[var(--text-primary)]">{source.name}</p>
              {source.category && (
                <p className="text-xs text-[var(--text-tertiary)]">{source.category}</p>
              )}
            </div>
          </div>
        </td>

        {/* Type */}
        <td className="px-6 py-4">
          <Badge>{TYPE_LABELS[source.source_type] ?? source.source_type}</Badge>
        </td>

        {/* Enabled toggle */}
        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onToggleEnabled(source)}
            disabled={isToggling}
            className={clsx(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              source.enabled ? "bg-radar-600" : "bg-gray-300 dark:bg-gray-600"
            )}
            role="switch"
            aria-checked={source.enabled}
            aria-label={`Toggle ${source.name}`}
          >
            <span
              className={clsx(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                source.enabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </td>

        {/* Last fetched - no warning triangle, just text */}
        <td className="px-6 py-4">
          <span className="text-sm text-[var(--text-secondary)]">
            {lastFetchedText}
          </span>
        </td>

        {/* Actions */}
        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onStartEdit(source)}
              className="btn-secondary text-xs"
              aria-label={`Edit ${source.name}`}
            >
              {t("sources.edit")}
            </button>
            <button
              onClick={() => onTriggerFetch(source)}
              disabled={isFetching || !source.enabled}
              className="btn-secondary text-xs"
              aria-label={`Trigger fetch for ${source.name}`}
            >
              {isFetching ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  Fetching...
                </span>
              ) : (
                t("sources.triggerFetch")
              )}
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded details */}
      {expanded && (
        <tr className="border-b border-[var(--border-primary)]">
          <td colSpan={5} className="px-6 py-4 bg-[var(--bg-secondary)]">
            <div className="animate-fade-in space-y-4 pl-7">
              {isEditing && editState ? (
                /* ─── Edit Mode ─────────────────────── */
                <SourceEditForm
                  source={source}
                  editState={editState}
                  isSaving={isSaving}
                  newQueryInput={newQueryInput}
                  onEditStateChange={onEditStateChange}
                  onNewQueryInputChange={onNewQueryInputChange}
                  onAddQuery={onAddQuery}
                  onRemoveQuery={onRemoveQuery}
                  onSave={() => onSaveEdit(source)}
                  onCancel={onCancelEdit}
                />
              ) : (
                /* ─── View Mode ─────────────────────── */
                <SourceDetailView source={source} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── SourceDetailView ──────────────────────────────────── */

function SourceDetailView({ source }: { source: Source }) {
  const { t } = useTranslation();
  const queryTerms = extractQueryTerms(source.config);
  const maxResults = extractMaxResults(source.config);
  const fetchInterval = extractFetchInterval(source.config);

  return (
    <div className="space-y-4">
      {/* Key details */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label={t("sources.category")} value={source.category} />
        <DetailItem label={t("sources.priority")} value={String(source.priority)} />
        {source.base_url && (
          <DetailItem label={t("sources.baseUrl")} value={source.base_url} />
        )}
        {maxResults > 0 && (
          <DetailItem label={t("sources.maxResults")} value={String(maxResults)} />
        )}
        {fetchInterval && (
          <DetailItem label={t("sources.fetchInterval")} value={fetchInterval} />
        )}
      </div>

      {/* Search queries / keywords as chips */}
      {queryTerms.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">
            {t("sources.searchQueries")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {queryTerms.map((term, index) => (
              <span
                key={`${term}-${index}`}
                className="inline-flex items-center rounded-full bg-radar-50 px-2.5 py-1 text-xs font-medium text-radar-700 dark:bg-radar-900/20 dark:text-radar-400"
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── SourceEditForm ────────────────────────────────────── */

interface SourceEditFormProps {
  source: Source;
  editState: EditState;
  isSaving: boolean;
  newQueryInput: string;
  onEditStateChange: React.Dispatch<React.SetStateAction<EditState | null>>;
  onNewQueryInputChange: (value: string) => void;
  onAddQuery: () => void;
  onRemoveQuery: (index: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

function SourceEditForm({
  source,
  editState,
  isSaving,
  newQueryInput,
  onEditStateChange,
  onNewQueryInputChange,
  onAddQuery,
  onRemoveQuery,
  onSave,
  onCancel,
}: SourceEditFormProps) {
  const { t } = useTranslation();

  const updateField = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    onEditStateChange((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  return (
    <div className="space-y-4">
      {/* Name (read-only) */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          {t("table.title")}
        </label>
        <p className="text-sm font-medium text-[var(--text-primary)]">{source.name}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Priority */}
        <div>
          <label
            htmlFor={`priority-${source.id}`}
            className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]"
          >
            {t("sources.priority")}
          </label>
          <select
            id={`priority-${source.id}`}
            value={editState.priority}
            onChange={(e) => updateField("priority", parseInt(e.target.value, 10))}
            className="input w-full"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => (
              <option key={val} value={val}>{val}</option>
            ))}
          </select>
        </div>

        {/* Base URL */}
        <div className="sm:col-span-2">
          <label
            htmlFor={`base-url-${source.id}`}
            className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]"
          >
            {t("sources.baseUrl")}
          </label>
          <input
            id={`base-url-${source.id}`}
            type="text"
            value={editState.baseUrl}
            onChange={(e) => updateField("baseUrl", e.target.value)}
            placeholder="https://..."
            className="input w-full"
          />
        </div>

        {/* Max Results */}
        <div>
          <label
            htmlFor={`max-results-${source.id}`}
            className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]"
          >
            {t("sources.maxResults")}
          </label>
          <input
            id={`max-results-${source.id}`}
            type="number"
            min={0}
            max={1000}
            value={editState.maxResults}
            onChange={(e) => updateField("maxResults", parseInt(e.target.value, 10) || 0)}
            className="input w-full"
          />
        </div>
      </div>

      {/* Search queries - editable chips */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]">
          {t("sources.searchQueries")}
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {editState.queryTerms.map((term, index) => (
            <span
              key={`${term}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-radar-50 px-2.5 py-1 text-xs font-medium text-radar-700 dark:bg-radar-900/20 dark:text-radar-400"
            >
              {term}
              <button
                type="button"
                onClick={() => onRemoveQuery(index)}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-radar-200 dark:hover:bg-radar-800 transition-colors"
                aria-label={`Remove ${term}`}
              >
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newQueryInput}
            onChange={(e) => onNewQueryInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddQuery();
              }
            }}
            placeholder={t("sources.addQuery")}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={onAddQuery}
            disabled={!newQueryInput.trim()}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="btn-primary text-sm"
        >
          {isSaving ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {t("sources.saving")}
            </span>
          ) : (
            t("sources.save")
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="btn-secondary text-sm"
        >
          {t("sources.cancel")}
        </button>
      </div>
    </div>
  );
}

/* ─── DetailItem ────────────────────────────────────────── */

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--text-primary)] break-all">{value ?? "\u2014"}</p>
    </div>
  );
}
