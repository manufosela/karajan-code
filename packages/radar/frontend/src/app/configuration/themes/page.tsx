"use client";

import { useState } from "react";
import Link from "next/link";

const INITIAL_GROUPS = [
  { key: "primary", label: "Ortodoncia primaria", keywords: ["orthodontics", "malocclusion", "aligner", "bracket", "archwire"] },
  { key: "materials", label: "Materiales", keywords: ["thermoplastic", "polyurethane", "PETG", "polycarbonate", "biocompatible"] },
  { key: "digital_workflow", label: "Digital workflow", keywords: ["CAD/CAM", "3D printing", "intraoral scanner", "CBCT", "digital planning"] },
  { key: "clinical", label: "Clinica", keywords: ["RCT", "clinical trial", "treatment outcome", "biomechanics", "force delivery"] },
  { key: "manufacturing", label: "Fabricacion", keywords: ["thermoforming", "direct printing", "laser sintering", "mass production"] },
  { key: "emerging", label: "Tecnologias emergentes", keywords: ["AI", "machine learning", "gene therapy", "nanotechnology", "bioprinting"] },
];

export default function ThemesPage() {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [newKeyword, setNewKeyword] = useState<Record<string, string>>({});

  const addKeyword = (groupKey: string) => {
    const kw = newKeyword[groupKey]?.trim();
    if (!kw) return;
    setGroups((prev) => prev.map((g) =>
      g.key === groupKey && !g.keywords.includes(kw)
        ? { ...g, keywords: [...g.keywords, kw] }
        : g
    ));
    setNewKeyword((prev) => ({ ...prev, [groupKey]: "" }));
  };

  const removeKeyword = (groupKey: string, keyword: string) => {
    setGroups((prev) => prev.map((g) =>
      g.key === groupKey ? { ...g, keywords: g.keywords.filter((k) => k !== keyword) } : g
    ));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/configuration" className="hover:text-radar-600 transition-colors">Configuration</Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Tematicas</span>
      </div>

      <h1 className="text-lg font-bold text-[var(--text-primary)]">Tematicas y Keywords</h1>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{group.label}</h3>
              <span className="text-2xs text-[var(--text-tertiary)]">{group.keywords.length} keywords</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {group.keywords.map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                  {kw}
                  <button onClick={() => removeKeyword(group.key, kw)} className="ml-0.5 text-[var(--text-tertiary)] hover:text-red-500 transition-colors">
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newKeyword[group.key] ?? ""}
                onChange={(e) => setNewKeyword((prev) => ({ ...prev, [group.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addKeyword(group.key)}
                placeholder="Agregar keyword..."
                className="input flex-1"
              />
              <button onClick={() => addKeyword(group.key)} className="btn-secondary">+</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
