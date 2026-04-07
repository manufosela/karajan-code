/**
 * HU CRUD operations on a v2 plan.
 * All functions mutate the plan in-place and return it.
 */

import { generateHuId } from "./plan-id.js";

/**
 * Get the next sequential HU number for this plan.
 */
function nextSeq(plan) {
  if (!plan.hus || plan.hus.length === 0) return 1;
  const nums = plan.hus
    .map(h => {
      const m = h.id.match(/_(\d+)$/);
      return m ? Number(m[1]) : 0;
    })
    .filter(n => n > 0);
  return nums.length > 0 ? Math.max(...nums) + 1 : plan.hus.length + 1;
}

/**
 * Add an HU to the plan. Auto-generates a globally unique ID.
 * @param {object} plan - v2 plan
 * @param {object} huData - { title, task_type?, scope?, acceptance_criteria?, acceptance_tests?, blocked_by? }
 * @returns {object} the created HU (with id assigned)
 */
export function addHu(plan, huData) {
  const seq = nextSeq(plan);
  const id = generateHuId(plan.planId, seq);
  const hu = {
    id,
    title: huData.title,
    task_type: huData.task_type || "sw",
    status: "pending",
    blocked_by: huData.blocked_by || [],
    scope: huData.scope || null,
    acceptance_criteria: huData.acceptance_criteria || [],
    acceptance_tests: huData.acceptance_tests || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  plan.hus.push(hu);
  plan.updatedAt = new Date().toISOString();
  return hu;
}

/**
 * Remove an HU from the plan. Also cleans blocked_by references.
 * @returns {boolean} true if removed
 */
export function removeHu(plan, huId) {
  const idx = plan.hus.findIndex(h => h.id === huId);
  if (idx === -1) return false;
  plan.hus.splice(idx, 1);
  // Clean up blocked_by refs
  for (const hu of plan.hus) {
    hu.blocked_by = (hu.blocked_by || []).filter(dep => dep !== huId);
  }
  plan.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Partial update of an HU.
 * @param {object} plan
 * @param {string} huId
 * @param {object} patch - fields to update (title, scope, task_type, acceptance_criteria, acceptance_tests, blocked_by)
 * @returns {object|null} updated HU or null if not found
 */
export function updateHu(plan, huId, patch) {
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return null;
  const allowed = ["title", "task_type", "scope", "acceptance_criteria", "acceptance_tests", "blocked_by"];
  for (const key of allowed) {
    if (patch[key] !== undefined) hu[key] = patch[key];
  }
  hu.updatedAt = new Date().toISOString();
  plan.updatedAt = new Date().toISOString();
  return hu;
}

/**
 * Update HU status.
 * @returns {boolean} true if updated
 */
export function updateHuStatus(plan, huId, status) {
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return false;
  hu.status = status;
  hu.updatedAt = new Date().toISOString();
  plan.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Mark all pending HUs as certified (ready to execute).
 * Sets plan status to "ready".
 * @returns {number} count of certified HUs
 */
export function certifyAllHus(plan) {
  let count = 0;
  for (const hu of plan.hus) {
    if (hu.status === "pending") {
      hu.status = "certified";
      hu.updatedAt = new Date().toISOString();
      count++;
    }
  }
  plan.status = "ready";
  plan.updatedAt = new Date().toISOString();
  return count;
}

/**
 * Reorder HUs by providing an ordered list of IDs.
 * Updates blocked_by to reflect the linear order.
 * @param {object} plan
 * @param {string[]} orderedIds
 */
export function reorderHus(plan, orderedIds) {
  const map = new Map(plan.hus.map(h => [h.id, h]));
  const reordered = [];
  for (const id of orderedIds) {
    const hu = map.get(id);
    if (hu) reordered.push(hu);
  }
  // Add any HUs not in the ordered list at the end
  for (const hu of plan.hus) {
    if (!orderedIds.includes(hu.id)) reordered.push(hu);
  }
  plan.hus = reordered;
  plan.updatedAt = new Date().toISOString();
}
