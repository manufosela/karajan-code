"use client";

import { useState } from "react";
import Link from "next/link";

export default function DeliveryPage() {
  const [threshold, setThreshold] = useState(6.0);
  const [maxItems, setMaxItems] = useState(10);
  const [language, setLanguage] = useState("both");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => setSaving(false), 500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/configuration" className="hover:text-radar-600 transition-colors">Configuration</Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Delivery</span>
      </div>

      <h1 className="text-lg font-bold text-[var(--text-primary)]">Delivery y General</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Digest settings */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Daily Digest</h2>
          <div className="mt-5 space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Umbral minimo de score ({threshold.toFixed(1)})
              </label>
              <input type="range" min={0} max={10} step={0.5} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-radar-600" />
              <div className="flex justify-between text-2xs text-[var(--text-tertiary)]">
                <span>0</span><span>5</span><span>10</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Max items por digest</label>
              <input type="number" min={1} max={50} value={maxItems}
                onChange={(e) => setMaxItems(Number(e.target.value))} className="input w-24" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Idioma del digest</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input">
                <option value="en">English</option>
                <option value="es">Espanol</option>
                <option value="both">Ambos (EN + ES)</option>
              </select>
            </div>
          </div>
        </div>

        {/* LLM settings */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">LLM Provider</h2>
          <div className="mt-5 space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Proveedor</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="input">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">Modelo</label>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} className="input" />
            </div>
            <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
              <p className="text-xs text-[var(--text-tertiary)]">
                El API key del proveedor se gestiona via variables de entorno (Secret Manager en produccion).
                No se muestra ni edita desde el dashboard.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? "Guardando..." : "Guardar configuracion"}
        </button>
      </div>
    </div>
  );
}
