/**
 * Plan v2 schema: plans with embedded HUs.
 * v1 = text-only plans (approach + steps + risks)
 * v2 = plans + executable HUs with acceptance tests
 */

import { generatePlanId, generateHuId } from "./plan-id.js";

const VALID_PLAN_STATUSES = new Set(["draft", "ready", "running", "done", "failed"]);
const VALID_HU_STATUSES = new Set(["pending", "certified", "coding", "reviewing", "done", "failed", "blocked"]);
const VALID_TASK_TYPES = new Set(["sw", "infra", "doc", "add-tests", "refactor", "nocode"]);

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
    if (hu.task_type && !VALID_TASK_TYPES.has(hu.task_type)) errors.push(`HU ${hu.id}: invalid task_type ${hu.task_type}`);
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
