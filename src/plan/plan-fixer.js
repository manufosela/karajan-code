/**
 * Plan fixer (KJC-BUG-0045 / P4) — self-fix loop after plan-reviewer.
 *
 * The reviewer is flag-only by contract. This module asks the planner
 * to PATCH the plan with the missing pieces and applies the patch
 * in-process. Patch shape:
 *   - additions:    new HUs (planner-step shape, id is auto-assigned)
 *   - deps_to_add:  blocked_by edges to declare on existing HUs
 *   - deletions:    HU ids to drop (used for overlap resolution)
 */

import { extractFirstJson } from "../utils/json-extract.js";
import { addHu, removeHu } from "./plan-hu-ops.js";
import { normaliseAcceptanceTests } from "./plan-schema.js";

export function buildFixerPrompt({ task, hus, findings }) {
  const huSummary = hus.map((h) => {
    const deps = Array.isArray(h.blocked_by) && h.blocked_by.length > 0
      ? ` ← blocked_by: ${h.blocked_by.join(", ")}` : "";
    return `- ${h.id}: ${h.title || "(untitled)"}${deps}`;
  }).join("\n");

  const missingHus = (findings?.missing_hus || [])
    .map(m => `  - §${m.spec_section}: ${m.rationale}`).join("\n");
  const missingDeps = (findings?.missing_dependencies || [])
    .map(d => `  - ${d.from} should be blocked_by ${d.on} (${d.rationale})`).join("\n");
  const overlaps = (findings?.scope_overlaps || [])
    .map(o => `  - ${o.between.join(" ↔ ")}: ${o.rationale}`).join("\n");

  return [
    "A reviewer flagged the issues listed under \"Findings\". Your ONLY",
    "job is to PATCH the plan to fix EXACTLY those issues:",
    "- missing_hus → MUST add one HU each",
    "- missing_dependencies → MUST declare each edge",
    "- scope_overlaps → MUST drop one of the pair or merge them",
    "Do NOT propose new features outside the findings list. Do not add new",
    "tests/logging/refactors. The fixer is scoped to the report ONLY.",
    "",
    "Output MUST be a JSON object:",
    "```json",
    "{",
    '  "additions": [',
    '    { "id": "<symbolic>", "description": "<sentence>",',
    '      "spec_section": "<ref>", "dependencies": ["<huId>"],',
    '      "acceptance_tests": [ { "type":"gherkin","content":"…" } ],',
    '      "reuse": [] }',
    "  ],",
    '  "deps_to_add": [ { "huId": "<huId>", "on": "<huId>" } ],',
    '  "deletions": [ "<huId>" ]',
    "}",
    "```",
    "Reference existing HUs by exact id. Empty arrays OK. JSON only.",
    "",
    "## Original Task",
    task,
    "",
    "## Current plan",
    huSummary,
    "",
    "## Findings to address",
    missingHus ? `### missing_hus (MUST add)\n${missingHus}` : "",
    missingDeps ? `### missing_dependencies (MUST declare)\n${missingDeps}` : "",
    overlaps ? `### scope_overlaps (MUST drop or merge)\n${overlaps}` : "",
  ].filter(Boolean).join("\n");
}

function normalisePatch(raw) {
  const out = { additions: [], deps_to_add: [], deletions: [] };
  if (!raw || typeof raw !== "object") return out;
  if (Array.isArray(raw.additions)) {
    out.additions = raw.additions
      .filter(a => a && typeof a === "object" && typeof a.description === "string" && a.description.trim())
      .map(a => ({
        id: typeof a.id === "string" ? a.id.trim() : null,
        description: String(a.description).trim(),
        spec_section: typeof a.spec_section === "string" ? a.spec_section.trim() || null : null,
        dependencies: Array.isArray(a.dependencies) ? a.dependencies.map(String) : [],
        acceptance_tests: normaliseAcceptanceTests(a.acceptance_tests),
        reuse: Array.isArray(a.reuse) ? a.reuse.map(String) : [],
      }));
  }
  if (Array.isArray(raw.deps_to_add)) {
    out.deps_to_add = raw.deps_to_add
      .filter(d => d && typeof d.huId === "string" && typeof d.on === "string")
      .map(d => ({ huId: d.huId.trim(), on: d.on.trim() }));
  }
  if (Array.isArray(raw.deletions)) {
    out.deletions = raw.deletions.filter(d => typeof d === "string" && d.trim()).map(d => d.trim());
  }
  return out;
}

export async function applyReviewerFeedback({ agent, task, hus, findings, onOutput, silenceTimeoutMs, timeoutMs }) {
  const prompt = buildFixerPrompt({ task, hus, findings });
  const runArgs = { prompt, role: "planner" };
  if (onOutput) runArgs.onOutput = onOutput;
  if (silenceTimeoutMs) runArgs.silenceTimeoutMs = silenceTimeoutMs;
  if (timeoutMs) runArgs.timeoutMs = timeoutMs;
  const result = await agent.runTask(runArgs);
  if (!result.ok) return { ok: false, error: result.error || "fixer agent failed" };
  const parsed = extractFirstJson(result.output || "");
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "fixer returned no JSON object" };
  }
  return { ok: true, patch: normalisePatch(parsed) };
}

export function applyFixerPatch(plan, patch) {
  const counts = { added: 0, depsAdded: 0, deleted: 0 };
  for (const huId of patch.deletions || []) {
    if (removeHu(plan, huId)) counts.deleted += 1;
  }
  // KJC-BUG-0053: las HUs añadidas por el fixer dejaban `short_id` y
  // `blocked_by` vacíos porque addHu no recibía esos campos. Resultado:
  // HUs huérfanas con id largo críptico y sin orden de ejecución.
  //
  // Fix: (1) pasar `short_id: a.id` (el id simbólico que el fixer LLM
  // asigna a cada addition). (2) resolver `a.dependencies` simbólicas
  // → hu.id largos contra el plan ya existente + el mapa de símbolos
  // recién añadidos. La resolución necesita 2 pasadas (primera crea
  // las HUs y registra el mapping, segunda asigna deps) para que
  // additions que se referencian entre sí funcionen.
  const symbolicToHuId = new Map();
  for (const hu of plan.hus) {
    if (hu.short_id) symbolicToHuId.set(hu.short_id, hu.id);
  }
  const addedHus = []; // {hu, depsSymbolic}
  for (const a of patch.additions || []) {
    const symbolicId = typeof a.id === "string" && a.id.trim() ? a.id.trim() : null;
    const hu = addHu(plan, {
      title: (a.description || "").slice(0, 80),
      scope: a.description,
      short_id: symbolicId,
      spec_section: a.spec_section,
      acceptance_tests: a.acceptance_tests,
      reuse: a.reuse || [],
    });
    if (symbolicId) symbolicToHuId.set(symbolicId, hu.id);
    const depsSymbolic = Array.isArray(a.dependencies) ? a.dependencies : [];
    addedHus.push({ hu, depsSymbolic });
    counts.added += 1;
  }
  // Pasada 2: resolver deps simbólicas de las additions a ids largos.
  for (const { hu, depsSymbolic } of addedHus) {
    const resolved = depsSymbolic
      .map((s) => typeof s === "string" ? symbolicToHuId.get(s.trim()) : null)
      .filter(Boolean);
    if (resolved.length > 0) hu.blocked_by = resolved;
  }
  const knownIds = new Set(plan.hus.map(h => h.id));
  for (const { huId, on } of patch.deps_to_add || []) {
    if (!knownIds.has(huId) || !knownIds.has(on)) continue;
    const hu = plan.hus.find(h => h.id === huId);
    if (!hu) continue;
    const blocked = Array.isArray(hu.blocked_by) ? hu.blocked_by : [];
    if (blocked.includes(on)) continue;
    hu.blocked_by = [...blocked, on];
    counts.depsAdded += 1;
  }
  if (counts.added + counts.depsAdded + counts.deleted > 0) {
    plan.updatedAt = new Date().toISOString();
  }
  return counts;
}
