/**
 * Plan + HU ID generation.
 * Globally unique IDs that never collide across plans.
 */

/**
 * Generate a unique plan ID: plan-<YYYYMMDDHHMMSS>-<4-char random>
 */
export function generatePlanId() {
  const now = new Date();
  const ts = now.toISOString().replaceAll(/[-:T]/g, "").replace(/\.\d+Z$/, "");
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

/**
 * Normalise a human-friendly name into a CLI-typeable alias.
 * "Greta App" → "greta-app", "Linux Assistant Orchestrator" → "linux-assistant-orchestrator".
 * Acotado a 60 chars para que no se vuelva tan ilegible como el planId.
 *
 * @param {string|null|undefined} name
 * @returns {string|null} alias o null si name está vacío.
 */
export function normaliseAlias(name) {
  if (!name || typeof name !== "string") return null;
  const slug = name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")        // strip diacritics
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")            // non-alphanum → guion
    .replaceAll(/^-+|-+$/g, "")                // trim guiones extremos
    .slice(0, 60);
  return slug || null;
}
