import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "flat";
  icon: React.ReactNode;
  accent?: string;
}

export function StatCard({ label, value, change, trend, icon, accent = "bg-radar-600" }: StatCardProps) {
  return (
    <div className="card group relative overflow-hidden p-5 transition-shadow hover:shadow-md">
      {/* Accent bar */}
      <div className={clsx("absolute inset-y-0 left-0 w-1 rounded-l-lg", accent)} />

      <div className="flex items-start justify-between">
        <div className="pl-2">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {value}
          </p>
          {change && (
            <p
              className={clsx(
                "mt-1 text-xs font-medium tabular-nums",
                trend === "up" && "text-emerald-600",
                trend === "down" && "text-red-500",
                trend === "flat" && "text-[var(--text-tertiary)]"
              )}
            >
              {trend === "up" && "+"}
              {change}
            </p>
          )}
        </div>
        <div
          className={clsx(
            "flex h-10 w-10 items-center justify-center rounded-lg text-white",
            accent
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
