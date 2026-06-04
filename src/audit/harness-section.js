// KJC-TSK-0471 — Harness Scorecard audit stage.
// Runs the markmishaev76/ai-harness-scorecard container after the deterministic
// phase, persists scorecard.json + scorecard-report.md under
// .karajan/audit-runs/<ts>/, and returns a summary the renderer surfaces as a
// "Harness Health Score" markdown block. KJC-TSK-0472 will consume the
// persisted artefacts to build audit-history.db.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeHarnessConfig, runHarnessAssess } from "./harness-scorecard.js";

const CATEGORIES = [
  ["architectural_docs", "Architectural Docs", 20],
  ["mechanical_constraints", "Mechanical Constraints", 25],
  ["testing_stability", "Testing & Stability", 25],
  ["review_drift_prevention", "Review & Drift Prevention", 15],
  ["ai_specific_safeguards", "AI-Specific Safeguards", 15],
];
const labelFor = (k) => CATEGORIES.find(([key]) => key === k)?.[1] || k;
const ts = () => new Date().toISOString().replaceAll(/[:.]/g, "-");

export async function runHarnessSection({ projectDir, harnessConfig = null, runAssess = runHarnessAssess } = {}) {
  const cfg = normalizeHarnessConfig(harnessConfig || {});
  if (!cfg.enabled) return { ok: true, skipped: true, reason: "disabled" };
  const res = await runAssess(projectDir, cfg);
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason, hint: res.hint, image: cfg.image };
  const outDir = path.join(projectDir, ".karajan", "audit-runs", ts());
  await fs.mkdir(outDir, { recursive: true });
  const scorecardPath = path.join(outDir, "scorecard.json");
  const rawReportPath = path.join(outDir, "scorecard-report.md");
  await fs.writeFile(scorecardPath, JSON.stringify(res.raw, null, 2), "utf8");
  await fs.writeFile(rawReportPath, res.raw?.report_markdown || res.raw?.markdown || "", "utf8");
  return {
    ok: true, score: res.score, grade: res.grade,
    categories: res.raw?.categories || {},
    checks: Array.isArray(res.raw?.checks) ? res.raw.checks : [],
    scorecardPath, rawReportPath, image: cfg.image,
  };
}

export function formatHarnessSection(summary) {
  if (!summary || summary.skipped) return "";
  if (!summary.ok) {
    const reason = summary.reason ? ` (${summary.reason})` : "";
    const hint = summary.hint ? `\n\n${summary.hint}\n` : "";
    return `## Harness Scorecard\n\n_skipped${reason}: ${summary.error}_${hint}\n`;
  }
  const lines = [
    `## Harness Health Score: ${summary.score}/100 (${summary.grade})`,
    "",
    "| Category | Weight | Score |",
    "| --- | --- | --- |",
  ];
  for (const [key, label, weight] of CATEGORIES) {
    const score = summary.categories?.[key]?.score ?? "—";
    lines.push(`| ${label} | ${weight}% | ${score} |`);
  }
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  if (checks.length) {
    const groups = new Map();
    for (const c of checks) {
      const k = c.category || "other";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    lines.push("", "### Checks");
    for (const [k, list] of groups) {
      lines.push(`- **${labelFor(k)}**`);
      for (const c of list) lines.push(`  - ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function harnessSummaryForJson(summary) {
  if (!summary?.ok || summary.skipped) return null;
  return {
    score: summary.score, grade: summary.grade,
    categories: summary.categories, checks: summary.checks,
    rawReportPath: summary.rawReportPath, scorecardPath: summary.scorecardPath,
  };
}
