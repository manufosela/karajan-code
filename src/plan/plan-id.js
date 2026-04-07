/**
 * Plan + HU ID generation.
 * Globally unique IDs that never collide across plans.
 */

/**
 * Generate a unique plan ID: plan-<YYYYMMDDHHMMSS>-<4-char random>
 */
export function generatePlanId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").replace(/\.\d+Z$/, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `plan-${ts}-${rand}`;
}

/**
 * Generate a globally unique HU ID scoped to a plan.
 * Format: hu_<planId>_<3-digit sequence>
 * @param {string} planId
 * @param {number} seq - 1-based sequence number
 * @returns {string}
 */
export function generateHuId(planId, seq) {
  return `hu_${planId}_${String(seq).padStart(3, "0")}`;
}
