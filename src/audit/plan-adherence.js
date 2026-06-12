/**
 * Plan adherence metric — KJC-TSK-0376 (deepeval-inspired).
 * Pure offline 0-100 score: how faithfully did the coder follow the plan?
 * Components (weighted): commit_attribution 40%, acceptance_tests 30%,
 * scope_discipline 20%, dependency_order 10%. Components return null
 * when no data; aggregator redistributes the weight.
 * See docs/plan-adherence.md (PR-C) for the full spec.
 */

import { escapeRegExp } from "../utils/escape-regexp.js";

const WEIGHTS = {
  commit_attribution: 40,
  acceptance_tests: 30,
  scope_discipline: 20,
  dependency_order: 10,
};

/**
 * Build a regex that matches the HU id anywhere in a commit message
 * (case-insensitive, word-boundary friendly). The `_` and `-` characters
 * appear inside HU ids so we anchor on whole-token rather than \b.
 */
function huIdMatcher(huId) {
  const escaped = escapeRegExp(huId);
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

/**
 * Slugify an HU title for branch-name / scope matching. Mirrors the
 * `buildHuBranchName` slug rule (lowercase, non-alnum → "-").
 */
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-+)|(-+$)/g, "");
}

/**
 * Try to attribute a single commit to one of the plan's HUs.
 *
 * Order of evidence, strongest first:
 *   1. The HU id appears in the commit message.
 *   2. The HU id appears in the branch name where the commit lives
 *      (commit.branch is supplied by listCommitsBetween's caller when
 *      it knows the per-HU branches).
 *   3. The HU title slug matches the commit message.
 *
 * Returns the matched huId, or null when none of the above fires.
 */
export function attributeCommitToHu(commit, hus) {
  if (!commit || !Array.isArray(hus) || hus.length === 0) return null;
  const msg = String(commit.message || "");
  const branch = String(commit.branch || "");
  for (const hu of hus) {
    if (!hu?.id) continue;
    const matcher = huIdMatcher(hu.id);
    if (matcher.test(msg)) return hu.id;
    if (branch && matcher.test(branch)) return hu.id;
  }
  // Fallback: title slug
  for (const hu of hus) {
    const slug = slugify(hu.title);
    if (!slug || slug.length < 6) continue;
    if (slugify(msg).includes(slug)) return hu.id;
  }
  return null;
}

/**
 * Component 1: commit attribution. Returns null when the run produced
 * no commits at all (avoids penalising analysis-only or doc-only runs).
 */
export function computeCommitAttribution(commits, plan) {
  if (!Array.isArray(commits) || commits.length === 0) return null;
  if (!plan?.hus || plan.hus.length === 0) return null;
  let attributed = 0;
  for (const commit of commits) {
    if (attributeCommitToHu(commit, plan.hus)) attributed += 1;
  }
  return Math.round((attributed / commits.length) * 100);
}

/**
 * Component 2: acceptance test coverage. Heuristic: each HU declares
 * `acceptance_tests`. We check whether at least one commit from that
 * HU's pool has a `test:`-prefixed message. Per-HU score (1 or 0),
 * averaged across HUs that DO declare tests. Returns null when no HU
 * declares acceptance tests.
 */
export function computeAcceptanceTestCoverage(commits, plan) {
  if (!plan?.hus || plan.hus.length === 0) return null;
  if (!Array.isArray(commits) || commits.length === 0) return null;
  const husWithTests = plan.hus.filter(
    (hu) => Array.isArray(hu?.acceptance_tests) && hu.acceptance_tests.length > 0,
  );
  if (husWithTests.length === 0) return null;

  let covered = 0;
  for (const hu of husWithTests) {
    const huCommits = (commits || []).filter(
      (c) => attributeCommitToHu(c, [hu]) === hu.id,
    );
    const hasTestCommit = huCommits.some((c) =>
      /^test[:(]/i.test(String(c.message || "").trim()),
    );
    if (hasTestCommit) covered += 1;
  }
  return Math.round((covered / husWithTests.length) * 100);
}

/**
 * Component 3: scope discipline. For each file changed by the run, we
 * try to match it against at least one HU's id slug, title slug, or
 * `scope` text. A file that matches no HU is flagged as out-of-scope.
 * Returns null when the run changed no files.
 */
export function computeScopeDiscipline(filesChanged, plan) {
  if (!Array.isArray(filesChanged) || filesChanged.length === 0) return null;
  if (!plan?.hus || plan.hus.length === 0) return null;
  const huKeywords = plan.hus.map((hu) => ({
    id: hu.id,
    matchers: [
      slugify(hu.id),
      slugify(hu.title),
      // Pull alpha-rich words from `scope` text (length >= 4).
      ...String(hu.scope || "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 4),
    ].filter(Boolean),
  }));
  let inScope = 0;
  for (const file of filesChanged) {
    const slug = slugify(file);
    const matched = huKeywords.some((hk) =>
      hk.matchers.some((m) => slug.includes(m) || file.includes(m)),
    );
    if (matched) inScope += 1;
  }
  return Math.round((inScope / filesChanged.length) * 100);
}

/**
 * Component 4: dependency order. For every `(parent, child)` edge
 * declared via `child.blocked_by`, check that the EARLIEST commit
 * attributed to `parent` is older than the EARLIEST commit attributed
 * to `child`. Returns null when no dependency edges exist.
 *
 * `commits` are expected oldest-first (the shape `listCommitsBetween`
 * returns). When that's not the case the score still makes sense — we
 * just compare relative positions in the array.
 */
export function computeDependencyOrder(commits, plan) {
  if (!plan?.hus || plan.hus.length === 0) return null;
  const edges = [];
  for (const hu of plan.hus) {
    for (const parentId of hu.blocked_by || []) {
      edges.push([parentId, hu.id]);
    }
  }
  if (edges.length === 0) return null;
  if (!Array.isArray(commits) || commits.length === 0) return null;

  // Build huId → first commit index (oldest first attribution).
  const firstIndex = new Map();
  commits.forEach((commit, idx) => {
    const huId = attributeCommitToHu(commit, plan.hus);
    if (huId && !firstIndex.has(huId)) firstIndex.set(huId, idx);
  });

  let respected = 0;
  let evaluable = 0;
  for (const [parentId, childId] of edges) {
    const p = firstIndex.get(parentId);
    const c = firstIndex.get(childId);
    if (p === undefined || c === undefined) continue; // can't evaluate
    evaluable += 1;
    if (p < c) respected += 1;
  }
  if (evaluable === 0) return null;
  return Math.round((respected / evaluable) * 100);
}

/**
 * Aggregator: compute every component and weight them. Components
 * that return `null` are excluded and their weight redistributed
 * proportionally across the rest, so a run that legitimately has no
 * acceptance tests or no dependencies isn't penalised.
 *
 * Returns the full structured result (see file header for shape).
 */
export function computePlanAdherenceScore({ commits, plan, filesChanged }) {
  const breakdown = {
    commit_attribution: computeCommitAttribution(commits, plan),
    acceptance_tests: computeAcceptanceTestCoverage(commits, plan),
    scope_discipline: computeScopeDiscipline(filesChanged, plan),
    dependency_order: computeDependencyOrder(commits, plan),
  };

  // Weighted average over non-null components only.
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = breakdown[key];
    if (value === null || value === undefined) continue;
    totalWeight += weight;
    weightedSum += value * weight;
  }
  const score = totalWeight === 0 ? null : Math.round(weightedSum / totalWeight);

  // Per-HU detail: was the HU "touched" (attributed at least one commit)?
  const hu_scores = (plan?.hus || []).map((hu) => {
    const huCommits = (commits || []).filter(
      (c) => attributeCommitToHu(c, [hu]) === hu.id,
    );
    const issues = [];
    if (huCommits.length === 0) issues.push("no commit attributed");
    return { huId: hu.id, attributed: huCommits.length > 0, issues };
  });

  return { score, breakdown, hu_scores };
}
