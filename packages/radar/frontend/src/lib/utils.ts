import { format, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";
import type { ReviewStatus } from "@/types/signal";

/**
 * Format an ISO date string to a human-readable format.
 */
export function formatDate(
  date: string | Date | null | undefined,
  pattern: string = "d MMM yyyy"
): string {
  if (!date) return "-";
  const parsed = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(parsed)) return "-";
  return format(parsed, pattern, { locale: es });
}

/**
 * Format a numeric score to 1 decimal place.
 */
export function formatScore(score: number | string | null | undefined): string {
  if (score === null || score === undefined) return "-";
  const num = typeof score === "string" ? parseFloat(score) : score;
  if (isNaN(num)) return "-";
  return num.toFixed(1);
}

/**
 * Return a Tailwind text color class based on score range.
 * Green for high (>= 7), yellow for medium (4-7), red for low (< 4).
 */
export function getScoreColor(score: number | string): string {
  const num = typeof score === "string" ? parseFloat(score) : score;
  if (num >= 7) return "text-emerald-500";
  if (num >= 4) return "text-amber-500";
  return "text-red-500";
}

/**
 * Return a Tailwind background color class based on score range.
 */
export function getScoreBgColor(score: number | string): string {
  const num = typeof score === "string" ? parseFloat(score) : score;
  if (num >= 7) return "bg-emerald-500";
  if (num >= 4) return "bg-amber-500";
  return "bg-red-500";
}

/**
 * Return Tailwind color classes for a review status.
 */
export function getStatusColor(status: ReviewStatus): {
  bg: string;
  text: string;
  border: string;
} {
  const colors: Record<ReviewStatus, { bg: string; text: string; border: string }> = {
    pending: {
      bg: "bg-slate-100 dark:bg-slate-800",
      text: "text-slate-700 dark:text-slate-300",
      border: "border-slate-300 dark:border-slate-600",
    },
    relevant: {
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      text: "text-emerald-700 dark:text-emerald-400",
      border: "border-emerald-300 dark:border-emerald-700",
    },
    review: {
      bg: "bg-amber-50 dark:bg-amber-900/20",
      text: "text-amber-700 dark:text-amber-400",
      border: "border-amber-300 dark:border-amber-700",
    },
    discarded: {
      bg: "bg-gray-50 dark:bg-gray-900/20",
      text: "text-gray-500 dark:text-gray-400",
      border: "border-gray-300 dark:border-gray-600",
    },
    opportunity: {
      bg: "bg-blue-50 dark:bg-blue-900/20",
      text: "text-blue-700 dark:text-blue-400",
      border: "border-blue-300 dark:border-blue-700",
    },
    follow_up: {
      bg: "bg-orange-50 dark:bg-orange-900/20",
      text: "text-orange-700 dark:text-orange-400",
      border: "border-orange-300 dark:border-orange-700",
    },
  };

  return colors[status] || colors.pending;
}

/**
 * A fixed, domain-neutral palette. Buckets are declared by the active Radar
 * Profile, so the frontend cannot know their names ahead of time; it derives a
 * stable colour from the bucket string instead of mapping specific ids.
 */
const BUCKET_PALETTE: ReadonlyArray<{ bg: string; text: string; dot: string }> = [
  { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  { bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  { bg: "bg-amber-50 dark:bg-amber-900/20", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  { bg: "bg-violet-50 dark:bg-violet-900/20", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  { bg: "bg-pink-50 dark:bg-pink-900/20", text: "text-pink-700 dark:text-pink-400", dot: "bg-pink-500" },
  { bg: "bg-teal-50 dark:bg-teal-900/20", text: "text-teal-700 dark:text-teal-400", dot: "bg-teal-500" },
  { bg: "bg-orange-50 dark:bg-orange-900/20", text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
  { bg: "bg-slate-50 dark:bg-slate-900/20", text: "text-slate-600 dark:text-slate-400", dot: "bg-slate-500" },
];

/**
 * Return stable, distinguishable Tailwind color classes for a strategic bucket.
 *
 * The colour is derived from the bucket name (a small string hash into a fixed
 * palette), so the same bucket always looks the same and different buckets
 * usually differ, without assuming any particular set of bucket ids.
 */
export function getBucketColor(bucket: string): {
  bg: string;
  text: string;
  dot: string;
} {
  let hash = 0;
  for (const char of bucket) {
    // `for...of` yields whole code points, so the first one is the character.
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 2147483647;
  }
  return BUCKET_PALETTE[hash % BUCKET_PALETTE.length];
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}
