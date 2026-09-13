"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardBody, CardFooter } from "@/components/ui/Card";
import { fetchActiveProfile, fetchConfiguration, updateConfiguration } from "@/lib/api";
import type { ProfileKeywordGroup } from "@/types/profile";
import clsx from "clsx";

interface KeywordGroup {
  positive: string[];
  negative: string[];
}

// Keyed by the group name the profile declares.
type KeywordData = Record<string, KeywordGroup>;

const EMPTY_GROUP: KeywordGroup = { positive: [], negative: [] };

// Which groups exist is the profile's call; how they look is the panel's, and
// it looks the same for every domain.
const GROUP_ICON = (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
  </svg>
);

function storedGroup(stored: unknown, name: string): KeywordGroup {
  if (typeof stored !== "object" || stored === null) return EMPTY_GROUP;
  const group = (stored as Record<string, Partial<KeywordGroup> | undefined>)[name];
  return { positive: group?.positive ?? [], negative: group?.negative ?? [] };
}

interface ToastState {
  message: string;
  type: "success" | "error";
  visible: boolean;
}

export function ThematicPanel() {
  const [groups, setGroups] = useState<ProfileKeywordGroup[]>([]);
  const [keywords, setKeywords] = useState<KeywordData>({});
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [toast, setToast] = useState<ToastState>({ message: "", type: "success", visible: false });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadKeywords() {
      try {
        const [profile, configs] = await Promise.all([fetchActiveProfile(), fetchConfiguration("thematic")]);
        if (!mounted) return;
        const profileGroups = profile.taxonomy.keyword_groups;
        const stored = configs.find((c) => c.key === "keywords")?.value;
        setGroups(profileGroups);
        setKeywords(Object.fromEntries(profileGroups.map((g) => [g.name, storedGroup(stored, g.name)])));
        setExpandedGroups(new Set(profileGroups.slice(0, 1).map((g) => g.name)));
        setHasError(false);
      } catch {
        if (mounted) setHasError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadKeywords();
    return () => { mounted = false; };
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const addKeyword = useCallback((group: string, type: "positive" | "negative", keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return false;

    const existing = keywords[group][type];
    if (existing.includes(trimmed)) return false;

    setKeywords((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [type]: [...prev[group][type], trimmed],
      },
    }));
    setHasChanges(true);
    return true;
  }, [keywords]);

  const removeKeyword = useCallback((group: string, type: "positive" | "negative", keyword: string) => {
    setKeywords((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [type]: prev[group][type].filter((k) => k !== keyword),
      },
    }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateConfiguration("thematic", "keywords", keywords as unknown as Record<string, unknown>);
      showToast("Keywords saved successfully", "success");
      setHasChanges(false);
    } catch {
      showToast("Failed to save keywords (offline mode)", "error");
    } finally {
      setSaving(false);
    }
  }, [keywords, showToast]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
            <span className="ml-3 text-[var(--text-secondary)]">Loading keywords...</span>
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
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">Unable to load keyword configuration</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Check that the backend is running.</p>
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
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          )}
          role="alert"
        >
          {toast.message}
        </div>
      )}

      {/* Header with save button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Keyword Groups</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Configure positive and negative keywords for signal classification
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="btn-primary"
          aria-label="Save keyword configuration"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving...
            </span>
          ) : (
            "Save Changes"
          )}
        </button>
      </div>

      {/* Keyword groups, as the active profile declares them */}
      {groups.length === 0 && (
        <p className="text-sm text-[var(--text-secondary)]">
          The active profile declares no keyword groups. Add them under taxonomy.keyword_groups in the profile.
        </p>
      )}
      <div className="space-y-3">
        {groups.map((meta) => (
          <KeywordGroupSection
            key={meta.name}
            group={keywords[meta.name]}
            meta={meta}
            expanded={expandedGroups.has(meta.name)}
            onToggle={() => toggleGroup(meta.name)}
            onAddKeyword={(type, keyword) => addKeyword(meta.name, type, keyword)}
            onRemoveKeyword={(type, keyword) => removeKeyword(meta.name, type, keyword)}
          />
        ))}
      </div>
    </div>
  );
}

interface KeywordGroupSectionProps {
  group: KeywordGroup;
  meta: ProfileKeywordGroup;
  expanded: boolean;
  onToggle: () => void;
  onAddKeyword: (type: "positive" | "negative", keyword: string) => boolean;
  onRemoveKeyword: (type: "positive" | "negative", keyword: string) => void;
}

function KeywordGroupSection({
  group,
  meta,
  expanded,
  onToggle,
  onAddKeyword,
  onRemoveKeyword,
}: KeywordGroupSectionProps) {
  const groupName = meta.name;
  const totalKeywords = group.positive.length + group.negative.length;

  return (
    <Card>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
        aria-expanded={expanded}
        aria-controls={`group-${groupName}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-radar-600">{GROUP_ICON}</span>
          <div>
            <h3 className="font-medium text-[var(--text-primary)]">{meta.label}</h3>
            <p className="text-xs text-[var(--text-tertiary)]">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-tertiary)]">
            {totalKeywords} keyword{totalKeywords !== 1 ? "s" : ""}
          </span>
          <svg
            className={clsx(
              "h-4 w-4 text-[var(--text-tertiary)] transition-transform",
              expanded && "rotate-180"
            )}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div id={`group-${groupName}`} className="animate-fade-in">
          <CardBody className="space-y-6 border-t border-[var(--border-primary)]">
            {/* Positive keywords */}
            <KeywordSection
              type="positive"
              keywords={group.positive}
              onAdd={(keyword) => onAddKeyword("positive", keyword)}
              onRemove={(keyword) => onRemoveKeyword("positive", keyword)}
            />

            {/* Negative keywords */}
            <KeywordSection
              type="negative"
              keywords={group.negative}
              onAdd={(keyword) => onAddKeyword("negative", keyword)}
              onRemove={(keyword) => onRemoveKeyword("negative", keyword)}
            />
          </CardBody>
        </div>
      )}
    </Card>
  );
}

interface KeywordSectionProps {
  type: "positive" | "negative";
  keywords: string[];
  onAdd: (keyword: string) => boolean;
  onRemove: (keyword: string) => void;
}

function KeywordSection({ type, keywords, onAdd, onRemove }: KeywordSectionProps) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPositive = type === "positive";

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError("Keyword cannot be empty");
      return;
    }
    const success = onAdd(trimmed);
    if (success) {
      setInputValue("");
      setError(null);
    } else {
      setError("Keyword already exists in this group");
    }
  }, [inputValue, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
      if (error) setError(null);
    },
    [handleAdd, error]
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={clsx(
            "h-2 w-2 rounded-full",
            isPositive ? "bg-emerald-500" : "bg-red-400"
          )}
        />
        <label
          htmlFor={`input-${type}`}
          className="text-sm font-medium text-[var(--text-secondary)]"
        >
          {isPositive ? "Positive Keywords" : "Negative Keywords"}
        </label>
        <span className="text-xs text-[var(--text-tertiary)]">({keywords.length})</span>
      </div>

      {/* Keyword chips */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              isPositive
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
            )}
          >
            {keyword}
            <button
              onClick={() => onRemove(keyword)}
              className={clsx(
                "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors",
                isPositive
                  ? "hover:bg-emerald-200 dark:hover:bg-emerald-800"
                  : "hover:bg-red-200 dark:hover:bg-red-800"
              )}
              aria-label={`Remove keyword "${keyword}"`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {keywords.length === 0 && (
          <span className="text-xs text-[var(--text-tertiary)] italic">No keywords defined</span>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            id={`input-${type}`}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Add ${isPositive ? "positive" : "negative"} keyword...`}
            className={clsx("input", error && "border-red-400 focus:border-red-400 focus:ring-red-500/20")}
            aria-label={`Add ${type} keyword`}
            aria-invalid={!!error}
          />
          {error && (
            <p className="mt-1 text-xs text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          onClick={handleAdd}
          className="btn-secondary shrink-0"
          aria-label={`Add ${type} keyword`}
        >
          Add
        </button>
      </div>
    </div>
  );
}
