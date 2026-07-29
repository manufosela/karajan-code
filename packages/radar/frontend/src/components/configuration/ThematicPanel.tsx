"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardBody, CardFooter } from "@/components/ui/Card";
import { fetchConfiguration, updateConfiguration } from "@/lib/api";
import clsx from "clsx";

interface KeywordGroup {
  positive: string[];
  negative: string[];
}

type GroupName = "primary" | "materials" | "digital_workflow" | "clinical" | "manufacturing" | "emerging";

type KeywordData = Record<GroupName, KeywordGroup>;

const EMPTY_KEYWORDS: KeywordData = {
  primary: { positive: [], negative: [] },
  materials: { positive: [], negative: [] },
  digital_workflow: { positive: [], negative: [] },
  clinical: { positive: [], negative: [] },
  manufacturing: { positive: [], negative: [] },
  emerging: { positive: [], negative: [] },
};

const GROUP_LABELS: Record<GroupName, { label: string; description: string; icon: React.ReactNode }> = {
  primary: {
    label: "Primary Keywords",
    description: "Core orthodontics and dental alignment terms",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
      </svg>
    ),
  },
  materials: {
    label: "Materials",
    description: "Material science and biomaterials",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
  },
  digital_workflow: {
    label: "Digital Workflow",
    description: "CAD/CAM, 3D printing and digital processes",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
      </svg>
    ),
  },
  clinical: {
    label: "Clinical",
    description: "Clinical studies and treatment evidence",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
  manufacturing: {
    label: "Manufacturing",
    description: "Production and manufacturing processes",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
      </svg>
    ),
  },
  emerging: {
    label: "Emerging",
    description: "Cutting-edge and experimental technologies",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
  },
};

const GROUP_ORDER: GroupName[] = ["primary", "materials", "digital_workflow", "clinical", "manufacturing", "emerging"];

interface ToastState {
  message: string;
  type: "success" | "error";
  visible: boolean;
}

export function ThematicPanel() {
  const [keywords, setKeywords] = useState<KeywordData>(EMPTY_KEYWORDS);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupName>>(new Set(["primary"]));
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
        const configs = await fetchConfiguration("thematic");
        if (!mounted) return;
        const keywordsConfig = configs.find((c) => c.key === "keywords");
        if (keywordsConfig && typeof keywordsConfig.value === "object" && !Array.isArray(keywordsConfig.value)) {
          setKeywords({ ...EMPTY_KEYWORDS, ...(keywordsConfig.value as Partial<KeywordData>) });
        }
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

  const toggleGroup = useCallback((group: GroupName) => {
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

  const addKeyword = useCallback((group: GroupName, type: "positive" | "negative", keyword: string) => {
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

  const removeKeyword = useCallback((group: GroupName, type: "positive" | "negative", keyword: string) => {
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

      {/* Keyword groups */}
      <div className="space-y-3">
        {GROUP_ORDER.map((groupName) => (
          <KeywordGroupSection
            key={groupName}
            groupName={groupName}
            group={keywords[groupName]}
            meta={GROUP_LABELS[groupName]}
            expanded={expandedGroups.has(groupName)}
            onToggle={() => toggleGroup(groupName)}
            onAddKeyword={(type, keyword) => addKeyword(groupName, type, keyword)}
            onRemoveKeyword={(type, keyword) => removeKeyword(groupName, type, keyword)}
          />
        ))}
      </div>
    </div>
  );
}

interface KeywordGroupSectionProps {
  groupName: GroupName;
  group: KeywordGroup;
  meta: { label: string; description: string; icon: React.ReactNode };
  expanded: boolean;
  onToggle: () => void;
  onAddKeyword: (type: "positive" | "negative", keyword: string) => boolean;
  onRemoveKeyword: (type: "positive" | "negative", keyword: string) => void;
}

function KeywordGroupSection({
  groupName,
  group,
  meta,
  expanded,
  onToggle,
  onAddKeyword,
  onRemoveKeyword,
}: KeywordGroupSectionProps) {
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
          <span className="text-radar-600">{meta.icon}</span>
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
