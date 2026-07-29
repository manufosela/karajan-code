export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-fade-in space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center gap-4">
            <div className="h-4 w-48 animate-pulse-soft rounded bg-[var(--bg-tertiary)]" />
            <div className="h-4 w-20 animate-pulse-soft rounded bg-[var(--bg-tertiary)]" />
            <div className="ml-auto h-4 w-16 animate-pulse-soft rounded bg-[var(--bg-tertiary)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5">
          <div className="h-3 w-24 animate-pulse-soft rounded bg-[var(--bg-tertiary)]" />
          <div className="mt-3 h-8 w-16 animate-pulse-soft rounded bg-[var(--bg-tertiary)]" />
        </div>
      ))}
    </div>
  );
}
