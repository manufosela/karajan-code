import clsx from "clsx";
import { getBucketColor } from "@/lib/utils";

type BadgeVariant = "default" | "score" | "status" | "bucket";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  bucket?: string;
  scoreColor?: "green" | "yellow" | "red";
  statusColor?: "green" | "yellow" | "gray" | "blue" | "orange";
}

const baseStyles =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors";

const variantStyles: Record<string, string> = {
  default:
    "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]",
  score: "font-semibold tabular-nums",
  status: "border",
};

const scoreColorStyles: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  yellow: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

const statusColorStyles: Record<string, string> = {
  green:
    "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700",
  yellow:
    "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700",
  gray: "bg-gray-50 text-gray-500 border-gray-300 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-600",
  blue: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
  orange:
    "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700",
};

export function Badge({
  children,
  variant = "default",
  className,
  bucket,
  scoreColor,
  statusColor,
}: BadgeProps) {
  if (variant === "bucket" && bucket) {
    const bucketColors = getBucketColor(bucket);
    return (
      <span
        className={clsx(baseStyles, bucketColors.bg, bucketColors.text, className)}
      >
        <span className={clsx("h-1.5 w-1.5 rounded-full", bucketColors.dot)} />
        {children}
      </span>
    );
  }

  if (variant === "score" && scoreColor) {
    return (
      <span
        className={clsx(baseStyles, variantStyles.score, scoreColorStyles[scoreColor], className)}
      >
        {children}
      </span>
    );
  }

  if (variant === "status" && statusColor) {
    return (
      <span
        className={clsx(baseStyles, variantStyles.status, statusColorStyles[statusColor], className)}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={clsx(baseStyles, variantStyles.default, className)}>
      {children}
    </span>
  );
}
