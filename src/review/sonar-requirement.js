/**
 * KJC-TSK-0838 (ADR "Sonar es un gate de commit no evadible", 2026-09-13) —
 * a diff that touches source files enters only with a sonar block that RAN
 * and COVERED every staged source; docs-only diffs are exempt. The only other
 * way through is a live HUMAN grant on `method.sonar.code` (kj policy grant:
 * identity, expiry, reason, anchored decision log). No env var is read here,
 * on purpose: an escape an agent can set for itself is the hole this closes
 * (KRD-TSK-0023 reached main in 4 code PRs with no real analysis).
 */
import { sourceFilesOf } from "./tests-with-code.js";

export const SONAR_RULE_ID = "method.sonar.code";

const GRANT_HINT = `Only a human grant lifts this: kj policy grant --rule ${SONAR_RULE_ID} --until <iso> --reason "<why>"`;

function liveGrant(standingExceptions, now) {
  return standingExceptions.find((e) => e.rule_id === SONAR_RULE_ID && new Date(e.expiresAt).getTime() > now.getTime()) || null;
}

/**
 * @returns {{ok: boolean, mode: "docs-only"|"pass"|"granted"|"block", reason?: string, grant?: object, sources?: string[]}}
 */
export function checkSonarRequirement({ config = {}, stagedFiles = [], sonar, standingExceptions = [], now = new Date() }) {
  const { sources } = sourceFilesOf(config, stagedFiles);
  if (sources.length === 0) return { ok: true, mode: "docs-only" };

  const grant = liveGrant(standingExceptions, now);
  if (grant) return { ok: true, mode: "granted", grant, sources };

  const head = `Sonar is mandatory for code (${sources.length} staged source${sources.length === 1 ? "" : "s"})`;
  if (!sonar) {
    return { ok: false, mode: "block", sources, reason: `${head} — the verdict carries no sonar block; run \`kj review --staged\` again. ${GRANT_HINT}` };
  }
  if (!sonar.ran) {
    return { ok: false, mode: "block", sources, reason: `${head} — the analysis did not run: ${sonar.reason || "unknown reason"}. ${GRANT_HINT}` };
  }
  // Recomputed from `covered` against the CURRENT staged sources: the diff
  // hash already pins the file set, so a source missing from the proof is a
  // source the scan never indexed, whatever the block claims.
  const coveredSet = new Set(sonar.covered || []);
  const uncovered = sources.filter((f) => !coveredSet.has(f));
  if (uncovered.length > 0) {
    const list = `${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? "…" : ""}`;
    return { ok: false, mode: "block", sources, reason: `${head} — the scan never indexed ${uncovered.length} of them (${list}): fix sonar-project.properties so they are analysed. ${GRANT_HINT}` };
  }
  return { ok: true, mode: "pass", sources };
}
