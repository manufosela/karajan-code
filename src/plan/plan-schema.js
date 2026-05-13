/**
 * Plan v2 schema: plans with embedded HUs.
 * v1 = text-only plans (approach + steps + risks)
 * v2 = plans + executable HUs with acceptance tests
 */

import { generatePlanId } from "./plan-id.js";

const VALID_PLAN_STATUSES = new Set(["draft", "ready", "running", "done", "failed"]);
// KJC-TSK-0394 step 5: el modelo CANONICAL del lifecycle es
// {pending, running, done}. Los valores certified/coding/reviewing/
// failed/blocked/needs_context se mantienen como LEGACY (siguen
// aceptados por validatePlan para no romper plans existentes ni el
// runtime actual). El cleanup definitivo del runtime queda como
// follow-up; mientras tanto la UI puede usar canonicalStatus +
// effectiveResult para presentar el modelo de 3 estados sin tocar
// la persistencia.
const VALID_HU_STATUSES = new Set([
  // Canonical
  "pending", "running", "done",
  // Legacy
  "certified", "coding", "reviewing", "failed", "blocked", "needs_context",
]);
export const CANONICAL_HU_STATUSES = new Set(["pending", "running", "done"]);
// KJC-TSK-0394: nuevo campo `result` ortogonal a status. Reemplaza la
// sobrecarga semántica del status (certified=pass, failed=fail) por una
// distinción explícita entre lifecycle (status) y último resultado (result).
// Vacío `null` significa "nunca ejecutado". Migración no-breaking: status
// legacy sigue válido durante el período de transición.
// Nota: usamos `result` y NO `outcome` porque el campo `outcome` ya existe
// con otra semántica (blob JSON con iterations/duration/commits del run).
export const VALID_HU_RESULTS = new Set([null, "pass", "fail", "partial"]);
const VALID_TASK_TYPES = new Set(["sw", "infra", "doc", "add-tests", "refactor", "nocode"]);
const VALID_TEST_TYPES = new Set(["shell", "gherkin"]);

/**
 * KJC-TSK-0394 step 4: deduce `result` de un HU legacy. Idempotente.
 * Heurística: done→pass (si hubiera fallado estaría en failed),
 * failed→fail, resto→null. NO toca status (eso es step 5).
 */
export function inferResultFromLegacyStatus(hu) {
  if (hu && hu.result != null) return hu.result;
  if (hu?.status === "done") return "pass";
  if (hu?.status === "failed") return "fail";
  return null;
}

/**
 * KJC-TSK-0394 step 5: mapea cualquier status (legacy o canonical) al
 * modelo CANONICAL {pending, running, done}. Permite que la UI y los
 * agregados (counts, kanban columns) trabajen contra un enum pequeño
 * sin tener que conocer todas las variantes legacy.
 *
 *   certified | blocked | needs_context | pending → pending
 *   coding | reviewing | running                  → running
 *   done | failed                                 → done
 *
 * `failed` mapea a `done` porque conceptualmente es lifecycle terminal
 * — el "falló" lo lleva el campo `result` ortogonal (step 1). Lo mismo
 * para `certified`: no es un lifecycle, es "ready to run" que en el
 * modelo canónico vive como `pending` + acceptance_tests no vacío.
 */
export function canonicalStatus(status) {
  switch (status) {
    case "running":
    case "coding":
    case "reviewing":
      return "running";
    case "done":
    case "failed":
      return "done";
    default:
      return "pending";
  }
}

/**
 * KJC-TSK-0394 step 5: result "efectivo" para la UI. Si el HU tiene
 * `result` poblado (plans migrados), lo usa directamente. Si no
 * (plans legacy pre-migración), lo deduce del status — equivalente a
 * inferResultFromLegacyStatus pero llamable directamente sobre cada
 * HU al renderizar.
 *
 * Permite a la UI mostrar badges ✓/✗ en plans antiguos sin esperar a
 * que el usuario corra `kj plan migrate-result`.
 */
export function effectiveResult(hu) {
  if (!hu) return null;
  if (hu.result !== undefined && hu.result !== null) return hu.result;
  return inferResultFromLegacyStatus(hu);
}

/**
 * Map a legacy status to (newStatus, result) pair. Used by addHu() defaults
 * and by the migration script in step 4. Idempotent: re-mapping a value that
 * is already in the canonical {pending, running, done} set keeps it.
 *
 * @param {string|null|undefined} legacy
 * @returns {{ status: string, result: string|null }}
 */
export function mapLegacyStatusToResult(legacy) {
  switch (legacy) {
    case "pending":
    case "blocked":         // blocked es lifecycle no terminal → pending
    case "needs_context":   // ídem
    case undefined:
    case null:
      return { status: "pending", result: null };
    case "coding":
    case "reviewing":
    case "running":
      return { status: "running", result: null };
    case "certified":
      return { status: "done", result: "pass" };
    case "failed":
      return { status: "done", result: "fail" };
    case "done":
      return { status: "done", result: null }; // sin result conocido (raro)
    default:
      return { status: "pending", result: null };
  }
}

/**
 * Structured acceptance-test shape introduced in v2.7.5 (tests-first):
 *
 *   { type: "shell",   content: "<bash command>", file?: "<optional path>" }
 *   { type: "gherkin", content: "Given …\nWhen …\nThen …", file?: "<optional path>" }
 *
 * Legacy entries (plain strings) are accepted by validatePlan and get
 * normalised to `{ type: "shell", content: <string> }` at read time by
 * `normaliseAcceptanceTest`. New plans MUST emit the structured form.
 *
 * Why two types: shell tests are executable as-is (a bash command that
 * exits 0 on pass); gherkin tests are human-readable specs that the
 * tester role translates into real code tests during `kj run` — they
 * are the contract the coder is expected to satisfy.
 *
 * @param {unknown} entry
 * @returns {{ type: string, content: string, file?: string } | null}
 */
export function normaliseAcceptanceTest(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return { type: "shell", content: trimmed };
  }
  if (typeof entry === "object" && typeof entry.content === "string") {
    const content = entry.content.trim();
    if (!content) return null;
    const type = VALID_TEST_TYPES.has(entry.type) ? entry.type : "shell";
    const out = { type, content };
    if (typeof entry.file === "string" && entry.file.trim()) out.file = entry.file.trim();
    return out;
  }
  return null;
}

/**
 * Normalise an array of raw acceptance_tests, dropping empties.
 * @param {unknown[]} list
 * @returns {{ type: string, content: string, file?: string }[]}
 */
export function normaliseAcceptanceTests(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normaliseAcceptanceTest).filter(Boolean);
}

/**
 * Check if a plan uses v2 schema (has version field + hus array).
 */
export function isPlanV2(plan) {
  return plan?.version === 2 && Array.isArray(plan.hus);
}

/**
 * Create an empty v2 plan.
 * @param {string} task - original task description
 * @param {object} [context] - research/architect/triage context
 * @returns {object} v2 plan with empty hus array
 */
export function createPlanV2(task, context = {}) {
  const planId = generatePlanId();
  return {
    planId,
    version: 2,
    task,
    name: null, // set by caller via deriveProjectName or manually
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "planner",
    context: {
      researchContext: context.researchContext || null,
      architectContext: context.architectContext || null,
      triageLevel: context.triageLevel || null,
      domain: context.domain || null
    },
    approach: null,
    risks: [],
    outOfScope: [],
    hus: []
  };
}

/**
 * Migrate a v1 plan to v2 schema. Preserves all existing data.
 * v1 plans have no HUs — they become v2 with empty hus array.
 * @param {object} v1plan
 * @returns {object} v2 plan
 */
export function migratePlanV1toV2(v1plan) {
  if (isPlanV2(v1plan)) return v1plan; // already v2
  return {
    planId: v1plan.planId,
    version: 2,
    task: v1plan.task || null,
    name: null,
    status: "draft",
    createdAt: v1plan.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "migrated",
    context: {
      researchContext: v1plan.researchContext || null,
      architectContext: v1plan.architectContext || null,
      triageLevel: null,
      domain: null
    },
    approach: v1plan.plan?.approach || (typeof v1plan.plan === "string" ? v1plan.plan : null),
    risks: v1plan.plan?.risks || [],
    outOfScope: v1plan.plan?.outOfScope || [],
    hus: [],
    _v1: { raw: v1plan.raw, plan: v1plan.plan } // preserve original for reference
  };
}

/**
 * Validate a v2 plan. Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validatePlan(plan) {
  const errors = [];

  if (!plan.planId) errors.push("Missing planId");
  if (plan.version !== 2) errors.push(`Expected version 2, got ${plan.version}`);
  if (!plan.task) errors.push("Missing task");
  if (!VALID_PLAN_STATUSES.has(plan.status)) errors.push(`Invalid status: ${plan.status}`);
  if (!Array.isArray(plan.hus)) errors.push("hus must be an array");

  const huIds = new Set();
  for (const hu of plan.hus || []) {
    if (!hu.id) { errors.push("HU missing id"); continue; }
    if (huIds.has(hu.id)) errors.push(`Duplicate HU id: ${hu.id}`);
    huIds.add(hu.id);
    if (!hu.title) errors.push(`HU ${hu.id}: missing title`);
    if (!VALID_HU_STATUSES.has(hu.status)) errors.push(`HU ${hu.id}: invalid status ${hu.status}`);
    // KJC-TSK-0394: result es opcional. Si está presente, debe ser pass/fail/partial.
    if (hu.result !== undefined && hu.result !== null && !VALID_HU_RESULTS.has(hu.result)) {
      errors.push(`HU ${hu.id}: invalid result ${hu.result} (expected pass|fail|partial|null)`);
    }
    if (hu.task_type && !VALID_TASK_TYPES.has(hu.task_type)) errors.push(`HU ${hu.id}: invalid task_type ${hu.task_type}`);
    // acceptance_tests: may be absent (legacy) or an array of either
    // plain strings (legacy shell) or { type, content, file? } objects.
    if (hu.acceptance_tests !== undefined) {
      if (!Array.isArray(hu.acceptance_tests)) {
        errors.push(`HU ${hu.id}: acceptance_tests must be an array`);
      } else {
        hu.acceptance_tests.forEach((entry, idx) => {
          if (typeof entry === "string") return; // legacy form — OK
          if (!entry || typeof entry !== "object") {
            errors.push(`HU ${hu.id}: acceptance_tests[${idx}] must be a string or { type, content } object`);
            return;
          }
          if (entry.type && !VALID_TEST_TYPES.has(entry.type)) {
            errors.push(`HU ${hu.id}: acceptance_tests[${idx}].type must be one of ${[...VALID_TEST_TYPES].join("|")}`);
          }
          if (typeof entry.content !== "string" || !entry.content.trim()) {
            errors.push(`HU ${hu.id}: acceptance_tests[${idx}].content must be a non-empty string`);
          }
        });
      }
    }
    // Check blocked_by references exist
    for (const dep of hu.blocked_by || []) {
      if (!huIds.has(dep) && !(plan.hus || []).some(h => h.id === dep)) {
        errors.push(`HU ${hu.id}: blocked_by references unknown HU ${dep}`);
      }
    }
  }

  // Check for circular dependencies
  try {
    topoSort(plan.hus || []);
  } catch {
    errors.push("Circular dependency detected in HU blocked_by graph");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Simple topological sort for cycle detection. */
function topoSort(hus) {
  const visited = new Set();
  const visiting = new Set();
  const order = [];
  const map = new Map(hus.map(h => [h.id, h]));

  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("cycle");
    visiting.add(id);
    const hu = map.get(id);
    for (const dep of hu?.blocked_by || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const hu of hus) visit(hu.id);
  return order;
}
