/**
 * hu-scheduler — pure scheduling for parallel HU execution (KJC-TSK-0623,
 * épica KJC-PCS-0065). Decides WHICH HUs may run concurrently; it never
 * launches anything. Two rules, both conservative by design:
 *
 *   1. Dependencies: every blocked_by id must be in completedIds.
 *   2. Scope isolation: two HUs whose scopes touch the same path prefix are
 *      never scheduled together — predictable merge conflicts cost more than
 *      the parallelism they'd buy. An HU with NO scope has an unknown blast
 *      radius, so it runs alone (exclusive with everything).
 */

/**
 * Extract path-like tokens from a free-form scope. The planner writes scope
 * as prose ("src/auth y tests/auth", "docs/*.md"); we keep anything that
 * looks like a path or glob, normalized to its base directory.
 */
export function scopeTokens(scope) {
  if (!scope || typeof scope !== "string") return [];
  const matches = scope.match(/[\w.-]+(?:\/[\w*.{}-]+)+|[\w.-]+\/(?=\s|$|,)/g) || [];
  return matches
    .map((raw) => {
      // Cut the token at its first glob segment: "src/**/*.js" → "src".
      const segments = raw.replace(/\/+$/, "").split("/");
      const firstGlob = segments.findIndex((s) => s.includes("*") || s.includes("{"));
      return (firstGlob === -1 ? segments : segments.slice(0, firstGlob)).join("/");
    })
    .filter(Boolean);
}

/** True when two token lists share a path-prefix relationship. */
function tokensOverlap(a, b) {
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb || ta.startsWith(`${tb}/`) || tb.startsWith(`${ta}/`)) return true;
    }
  }
  return false;
}

/**
 * True when two HUs cannot run concurrently: either one has no parseable
 * scope (unknown blast radius ⇒ exclusive) or their scopes overlap.
 */
export function husConflict(huA, huB) {
  const a = scopeTokens(huA.scope);
  const b = scopeTokens(huB.scope);
  if (a.length === 0 || b.length === 0) return true;
  return tokensOverlap(a, b);
}

/**
 * Select the next HUs to launch, order-preserving and greedy.
 *
 * @param {object} args
 * @param {Array<{id: string, blocked_by?: string[], scope?: string|null}>} args.hus - candidates, in plan order
 * @param {string[]} [args.completedIds] - HUs already done (dependency source)
 * @param {Array<{id: string, scope?: string|null}>} [args.inFlight] - HUs currently running
 * @param {number} [args.maxParallel] - total concurrency cap (in-flight included)
 * @returns {{ selected: object[], blocked: Array<{id: string, reason: string}> }}
 */
export function selectRunnableHus({ hus = [], completedIds = [], inFlight = [], maxParallel = 1 } = {}) {
  const done = new Set(completedIds);
  const flying = new Set(inFlight.map((h) => h.id));
  const slots = Math.max(0, maxParallel - inFlight.length);
  const selected = [];
  const blocked = [];

  for (const hu of hus) {
    if (flying.has(hu.id) || done.has(hu.id)) continue;
    const missing = (hu.blocked_by || []).filter((dep) => !done.has(dep));
    if (missing.length > 0) {
      blocked.push({ id: hu.id, reason: `waiting for ${missing.join(", ")}` });
      continue;
    }
    if (selected.length >= slots) {
      blocked.push({ id: hu.id, reason: "no free slot" });
      continue;
    }
    const rival = [...inFlight, ...selected].find((other) => husConflict(hu, other));
    if (rival) {
      blocked.push({ id: hu.id, reason: `scope conflicts with ${rival.id}` });
      continue;
    }
    selected.push(hu);
  }
  return { selected, blocked };
}
