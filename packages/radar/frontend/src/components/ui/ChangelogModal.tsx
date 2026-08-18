"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/lib/i18n";
import { changelog } from "@/lib/changelog";
import type { ChangelogEntry } from "@/lib/changelog";

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_STYLES: Record<
  ChangelogEntry["changes"][number]["category"],
  { bg: string; text: string; label: string }
> = {
  feat: { bg: "bg-blue-500/15", text: "text-blue-400", label: "feat" },
  fix: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "fix" },
  refactor: { bg: "bg-amber-500/15", text: "text-amber-400", label: "refactor" },
  perf: { bg: "bg-purple-500/15", text: "text-purple-400", label: "perf" },
};

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  const modal = (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={t("changelog.title")}
    >
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("changelog.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label={t("changelog.close")}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {changelog.map((entry, idx) => (
            <div
              key={entry.version}
              className={idx > 0 ? "mt-8 border-t border-[var(--border-primary)] pt-8" : ""}
            >
              {/* Version + date */}
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-bold text-[var(--text-primary)]">
                  v{entry.version}
                </span>
                <span className="text-sm text-[var(--text-tertiary)]">
                  {entry.date}
                </span>
              </div>

              {/* Highlights */}
              {entry.highlights.length > 0 && (
                <div className="mt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    {t("changelog.highlights")}
                  </h3>
                  <ul className="space-y-1.5">
                    {entry.highlights.map((highlight, hIdx) => (
                      <li
                        key={hIdx}
                        className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                      >
                        <svg
                          className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Changes */}
              <div className="mt-4 space-y-2">
                {entry.changes.map((change, cIdx) => {
                  const style = CATEGORY_STYLES[change.category];
                  return (
                    <div
                      key={cIdx}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <span
                        className={`inline-flex flex-shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {change.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
