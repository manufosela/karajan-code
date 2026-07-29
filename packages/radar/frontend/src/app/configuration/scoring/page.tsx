"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";

const INITIAL_WEIGHTS = [
  { key: "proximity_to_aligners", label: "Proximidad a alineadores", value: 25 },
  { key: "impact", label: "Impacto potencial", value: 20 },
  { key: "evidence_quality", label: "Calidad de evidencia", value: 15 },
  { key: "time_to_applicability", label: "Tiempo de aplicabilidad", value: 15 },
  { key: "novelty", label: "Novedad", value: 10 },
  { key: "competitive_advantage", label: "Ventaja competitiva", value: 10 },
  { key: "strategic_priority", label: "Afinidad estrategica", value: 5 },
];

export default function ScoringPage() {
  const [weights, setWeights] = useState(INITIAL_WEIGHTS);
  const [saving, setSaving] = useState(false);
  const total = weights.reduce((sum, w) => sum + w.value, 0);
  const isValid = total === 100;

  const updateWeight = (key: string, value: number) => {
    setWeights((prev) => prev.map((w) => w.key === key ? { ...w, value } : w));
  };

  const handleSave = () => {
    if (!isValid) return;
    setSaving(true);
    setTimeout(() => setSaving(false), 500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/configuration" className="hover:text-radar-600 transition-colors">Configuration</Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Scoring</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--text-primary)]">Pesos de Scoring Estrategico</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Los pesos deben sumar 100%</p>
        </div>
        <div className={clsx("rounded-full px-4 py-2 text-sm font-bold tabular-nums",
          isValid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        )}>
          Total: {total}%
        </div>
      </div>

      <div className="card divide-y divide-[var(--border-primary)]">
        {weights.map((w) => (
          <div key={w.key} className="flex items-center gap-6 px-6 py-4">
            <div className="w-48 flex-shrink-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{w.label}</p>
              <p className="text-2xs text-[var(--text-tertiary)]">{w.key}</p>
            </div>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={50}
                value={w.value}
                onChange={(e) => updateWeight(w.key, Number(e.target.value))}
                className="w-full accent-radar-600"
              />
            </div>
            <div className="w-16 text-right">
              <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{w.value}</span>
              <span className="text-sm text-[var(--text-tertiary)]">%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={!isValid || saving} className="btn-primary">
          {saving ? "Guardando..." : "Guardar pesos"}
        </button>
      </div>
    </div>
  );
}
