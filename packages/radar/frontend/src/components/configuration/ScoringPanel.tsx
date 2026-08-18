"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardHeader, CardBody, CardFooter } from "@/components/ui/Card";
import { fetchConfiguration, updateConfiguration } from "@/lib/api";
import clsx from "clsx";

interface WeightDefinition {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
}

const SCIENTIFIC_WEIGHTS: WeightDefinition[] = [
  { key: "methodology", label: "Methodology", description: "Quality and rigor of research methodology", defaultValue: 30 },
  { key: "sample_size", label: "Sample Size", description: "Adequacy of sample size for conclusions", defaultValue: 15 },
  { key: "journal_impact", label: "Journal Impact", description: "Impact factor of the publishing journal", defaultValue: 15 },
  { key: "citation_count", label: "Citation Count", description: "Number and quality of citations", defaultValue: 10 },
  { key: "recency", label: "Recency", description: "How recently the research was published", defaultValue: 10 },
  { key: "reproducibility", label: "Reproducibility", description: "Likelihood of reproducing results", defaultValue: 10 },
  { key: "clinical_applicability", label: "Clinical Applicability", description: "Relevance to real clinical settings", defaultValue: 10 },
];

const STRATEGIC_WEIGHTS: WeightDefinition[] = [
  { key: "proximity_to_aligners", label: "Proximity to Aligners", description: "Direct relevance to aligner technology", defaultValue: 25 },
  { key: "impact", label: "Impact", description: "Potential business and clinical impact", defaultValue: 20 },
  { key: "evidence_quality", label: "Evidence Quality", description: "Strength of supporting evidence", defaultValue: 15 },
  { key: "time_to_applicability", label: "Time to Applicability", description: "How soon it could be applied", defaultValue: 15 },
  { key: "novelty", label: "Novelty", description: "Innovation level compared to existing solutions", defaultValue: 10 },
  { key: "competitive_advantage", label: "Competitive Advantage", description: "Competitive differentiation potential", defaultValue: 10 },
  { key: "strategic_priority_affinity", label: "Strategic Priority Affinity", description: "Alignment with strategic business priorities", defaultValue: 5 },
];

type WeightValues = Record<string, number>;

function buildDefaultWeights(definitions: WeightDefinition[]): WeightValues {
  const weights: WeightValues = {};
  for (const def of definitions) {
    weights[def.key] = def.defaultValue;
  }
  return weights;
}

interface ToastState {
  message: string;
  type: "success" | "error";
  visible: boolean;
}

export function ScoringPanel() {
  const [scientificWeights, setScientificWeights] = useState<WeightValues>(
    () => buildDefaultWeights(SCIENTIFIC_WEIGHTS)
  );
  const [strategicWeights, setStrategicWeights] = useState<WeightValues>(
    () => buildDefaultWeights(STRATEGIC_WEIGHTS)
  );
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [toast, setToast] = useState<ToastState>({ message: "", type: "success", visible: false });

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadWeights() {
      try {
        const configs = await fetchConfiguration("scoring");
        if (!mounted) return;

        const sciConfig = configs.find((c) => c.key === "scientific_weights");
        if (sciConfig && typeof sciConfig.value === "object" && !Array.isArray(sciConfig.value)) {
          setScientificWeights({ ...buildDefaultWeights(SCIENTIFIC_WEIGHTS), ...(sciConfig.value as WeightValues) });
        }

        const strConfig = configs.find((c) => c.key === "strategic_weights");
        if (strConfig && typeof strConfig.value === "object" && !Array.isArray(strConfig.value)) {
          setStrategicWeights({ ...buildDefaultWeights(STRATEGIC_WEIGHTS), ...(strConfig.value as WeightValues) });
        }

        setHasError(false);
      } catch {
        if (mounted) setHasError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadWeights();
    return () => { mounted = false; };
  }, []);

  const scientificTotal = useMemo(
    () => Object.values(scientificWeights).reduce((sum, v) => sum + v, 0),
    [scientificWeights]
  );

  const strategicTotal = useMemo(
    () => Object.values(strategicWeights).reduce((sum, v) => sum + v, 0),
    [strategicWeights]
  );

  const handleScientificChange = useCallback((key: string, value: number) => {
    setScientificWeights((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const handleStrategicChange = useCallback((key: string, value: number) => {
    setStrategicWeights((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const normalizeWeights = useCallback((weights: WeightValues, setWeights: (w: WeightValues) => void) => {
    const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
    if (total === 0) return;

    const normalized: WeightValues = {};
    const keys = Object.keys(weights);
    let remaining = 100;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      normalized[key] = Math.round((weights[key] / total) * 100);
      remaining -= normalized[key];
    }
    normalized[keys[keys.length - 1]] = remaining;

    setWeights(normalized);
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (scientificTotal !== 100 || strategicTotal !== 100) {
      showToast("Both weight sections must sum to 100% before saving", "error");
      return;
    }

    setSaving(true);
    try {
      await updateConfiguration("scoring", "scientific_weights", scientificWeights as unknown as Record<string, unknown>);
      await updateConfiguration("scoring", "strategic_weights", strategicWeights as unknown as Record<string, unknown>);
      showToast("Scoring weights saved successfully", "success");
      setHasChanges(false);
    } catch {
      showToast("Failed to save weights (offline mode)", "error");
    } finally {
      setSaving(false);
    }
  }, [scientificWeights, strategicWeights, scientificTotal, strategicTotal, showToast]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-600 border-t-transparent" />
            <span className="ml-3 text-[var(--text-secondary)]">Loading scoring weights...</span>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (hasError) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="h-12 w-12 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">Unable to load scoring configuration</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Using default weights. Check that the backend is running.</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast.visible && (
        <div
          className={clsx(
            "fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-slide-up",
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          )}
          role="alert"
        >
          {toast.message}
        </div>
      )}

      {/* Scientific Strength Weights */}
      <WeightSection
        title="Scientific Strength Weights"
        description="Define how each scientific criterion contributes to the overall scientific score"
        definitions={SCIENTIFIC_WEIGHTS}
        weights={scientificWeights}
        total={scientificTotal}
        onChange={handleScientificChange}
        onNormalize={() => normalizeWeights(scientificWeights, setScientificWeights)}
      />

      {/* Strategic Relevance Weights */}
      <WeightSection
        title="Strategic Relevance Weights"
        description="Define how each strategic criterion contributes to the overall strategic score"
        definitions={STRATEGIC_WEIGHTS}
        weights={strategicWeights}
        total={strategicTotal}
        onChange={handleStrategicChange}
        onNormalize={() => normalizeWeights(strategicWeights, setStrategicWeights)}
      />

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="btn-primary"
          aria-label="Save scoring configuration"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving...
            </span>
          ) : (
            "Save Weights"
          )}
        </button>
      </div>
    </div>
  );
}

interface WeightSectionProps {
  title: string;
  description: string;
  definitions: WeightDefinition[];
  weights: WeightValues;
  total: number;
  onChange: (key: string, value: number) => void;
  onNormalize: () => void;
}

function WeightSection({
  title,
  description,
  definitions,
  weights,
  total,
  onChange,
  onNormalize,
}: WeightSectionProps) {
  const isValid = total === 100;
  const difference = total - 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{description}</p>
          </div>
          <div className="flex items-center gap-3">
            {!isValid && (
              <button
                onClick={onNormalize}
                className="btn-secondary text-xs"
                aria-label="Auto-normalize weights to 100%"
              >
                Auto-normalize
              </button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {definitions.map((def) => (
          <WeightSlider
            key={def.key}
            definition={def}
            value={weights[def.key]}
            onChange={(value) => onChange(def.key, value)}
          />
        ))}
      </CardBody>

      <CardFooter>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--text-secondary)]">Total:</span>
            <span
              className={clsx(
                "text-lg font-bold tabular-nums",
                isValid ? "text-emerald-600" : "text-red-500"
              )}
            >
              {total}%
            </span>
            {!isValid && (
              <span className="text-sm text-red-500">
                ({difference > 0 ? "+" : ""}{difference}% {difference > 0 ? "over" : "under"})
              </span>
            )}
          </div>

          {/* Visual total bar */}
          <div className="flex items-center gap-2">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
              <div
                className={clsx(
                  "h-full rounded-full transition-all",
                  isValid ? "bg-emerald-500" : total > 100 ? "bg-red-500" : "bg-amber-500"
                )}
                style={{ width: `${Math.min(total, 100)}%` }}
              />
            </div>
            {isValid && (
              <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            )}
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

interface WeightSliderProps {
  definition: WeightDefinition;
  value: number;
  onChange: (value: number) => void;
}

function WeightSlider({ definition, value, onChange }: WeightSliderProps) {
  const sliderColor = useMemo(() => {
    if (value === 0) return "bg-gray-300";
    if (value <= 10) return "bg-radar-300";
    if (value <= 25) return "bg-radar-500";
    return "bg-radar-600";
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <label
            htmlFor={`slider-${definition.key}`}
            className="text-sm font-medium text-[var(--text-primary)]"
          >
            {definition.label}
          </label>
          <p className="text-xs text-[var(--text-tertiary)]">{definition.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-[3rem] text-right text-lg font-bold tabular-nums text-[var(--text-primary)]">
            {value}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          {/* Track background */}
          <div className="h-2 w-full rounded-full bg-[var(--bg-tertiary)]">
            <div
              className={clsx("h-full rounded-full transition-all", sliderColor)}
              style={{ width: `${value}%` }}
            />
          </div>
          {/* Range input overlay */}
          <input
            id={`slider-${definition.key}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${definition.label} weight: ${value}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
          />
          {/* Custom thumb indicator */}
          <div
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-radar-600 shadow-sm transition-all"
            style={{ left: `${value}%` }}
          />
        </div>
      </div>
    </div>
  );
}
