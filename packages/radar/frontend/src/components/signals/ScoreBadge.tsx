import clsx from "clsx";
import { formatScore, getScoreColor, getScoreBgColor } from "@/lib/utils";

interface ScoreBadgeProps {
  score: number | string | null | undefined;
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "pill" | "circle";
  className?: string;
}

export function ScoreBadge({
  score,
  label,
  size = "sm",
  variant = "pill",
  className,
}: ScoreBadgeProps) {
  const numericScore = typeof score === "string" ? parseFloat(score) : score;
  if (numericScore === null || numericScore === undefined || isNaN(numericScore)) {
    return null;
  }
  const formattedScore = formatScore(numericScore);

  if (variant === "circle") {
    const sizeClasses = {
      sm: "h-8 w-8 text-xs",
      md: "h-10 w-10 text-sm",
      lg: "h-14 w-14 text-lg",
    };

    return (
      <div className={clsx("flex flex-col items-center gap-1", className)}>
        <div
          className={clsx(
            "flex items-center justify-center rounded-full font-bold text-white",
            sizeClasses[size],
            getScoreBgColor(numericScore)
          )}
        >
          {formattedScore}
        </div>
        {label && (
          <span className="text-2xs font-medium text-[var(--text-tertiary)]">
            {label}
          </span>
        )}
      </div>
    );
  }

  /* Pill variant (default) */
  const pillSizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
    lg: "px-3 py-1.5 text-base",
  };

  const pillColorClasses = (() => {
    if (numericScore >= 7)
      return "bg-emerald-50 dark:bg-emerald-900/20";
    if (numericScore >= 4)
      return "bg-amber-50 dark:bg-amber-900/20";
    return "bg-red-50 dark:bg-red-900/20";
  })();

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular-nums",
        pillSizeClasses[size],
        pillColorClasses,
        getScoreColor(numericScore),
        className
      )}
    >
      {formattedScore}
      {label && (
        <span className="text-2xs font-normal opacity-70">{label}</span>
      )}
    </span>
  );
}
