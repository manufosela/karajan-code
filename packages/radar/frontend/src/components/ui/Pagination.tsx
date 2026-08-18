"use client";

import clsx from "clsx";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pages = getPageNumbers(page, totalPages);

  return (
    <div className="flex items-center justify-between border-t border-[var(--border-primary)] px-2 pt-4">
      <p className="text-xs text-[var(--text-tertiary)] tabular-nums">
        {from}&ndash;{to} de {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
        >
          &laquo;
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`dots-${i}`} className="px-1 text-xs text-[var(--text-tertiary)]">
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={clsx(
                "min-w-[28px] rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                p === page
                  ? "bg-radar-600 text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              )}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
        >
          &raquo;
        </button>
      </div>
    </div>
  );
}

function getPageNumbers(
  current: number,
  total: number
): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");
  pages.push(total);

  return pages;
}
