"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";

const DEMO_SOURCES = [
  { id: "1", name: "PubMed", type: "api", enabled: true, category: "biomedical", last_fetched: "2026-03-20T03:00:00Z", items_total: 67, priority: 1 },
  { id: "2", name: "arXiv", type: "api", enabled: true, category: "preprints", last_fetched: "2026-03-20T03:05:00Z", items_total: 34, priority: 2 },
  { id: "3", name: "Crossref", type: "api", enabled: true, category: "cross-publisher", last_fetched: "2026-03-20T03:10:00Z", items_total: 28, priority: 3 },
  { id: "4", name: "Semantic Scholar", type: "api", enabled: true, category: "ai-enriched", last_fetched: "2026-03-20T03:15:00Z", items_total: 19, priority: 4 },
  { id: "5", name: "ClinicalTrials.gov", type: "api", enabled: true, category: "clinical_trials", last_fetched: "2026-03-20T03:20:00Z", items_total: 8, priority: 5 },
];

export default function SourcesPage() {
  const [sources, setSources] = useState(DEMO_SOURCES);

  const toggleSource = (id: string) => {
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/configuration" className="hover:text-radar-600 transition-colors">Configuration</Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Fuentes</span>
      </div>

      <h1 className="text-lg font-bold text-[var(--text-primary)]">Fuentes de datos</h1>

      <div className="space-y-3">
        {sources.map((source) => (
          <div key={source.id} className={clsx("card p-5 transition-all", !source.enabled && "opacity-60")}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={clsx("flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold",
                  source.enabled ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-400"
                )}>
                  {source.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--text-primary)]">{source.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                    <span>{source.type.toUpperCase()}</span>
                    <span>&middot;</span>
                    <span>{source.category}</span>
                    <span>&middot;</span>
                    <span>{source.items_total} items</span>
                    <span>&middot;</span>
                    <span>Prioridad {source.priority}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--text-tertiary)]">
                  Ultimo fetch: {new Date(source.last_fetched).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={() => toggleSource(source.id)}
                  className={clsx("relative h-6 w-11 rounded-full transition-colors",
                    source.enabled ? "bg-teal-500" : "bg-gray-300"
                  )}
                >
                  <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    source.enabled ? "left-[22px]" : "left-0.5"
                  )} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
