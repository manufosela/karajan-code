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
/** KJC-BUG-0229, HU-4046: the paths alive after a change (all but D, a type change T too), one set at commit, publish and CI. */
export const LIVE_FILTER = "--diff-filter=ACMRT";

const GRANT_HINT = `Only a human grant lifts this: kj policy grant --rule ${SONAR_RULE_ID} --until <iso> --reason "<why>"`;

function liveGrant(standingExceptions, now) {
  return standingExceptions.find((e) => e.rule_id === SONAR_RULE_ID && new Date(e.expiresAt).getTime() > now.getTime()) || null;
}

/**
 * @returns {{ok: boolean, mode: "docs-only"|"pass"|"granted"|"block", reason?: string, grant?: object, sources?: string[]}}
 */
export function checkSonarRequirement({ config = {}, stagedFiles = [], sonar, standingExceptions = [], now = new Date(), generated }) {
  const { sources } = sourceFilesOf(config, stagedFiles, generated);
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

/**
 * HU-4046: the Sonar proof a verdict carries for the files it covers, one predicate for the
 * commit gate (--check) and for kj review --publish-pr. The headless pipeline scans the whole
 * project (no per-file proof yet), so its stamp must at least show the stage RAN.
 * @returns {{ok: boolean, mode: "docs-only"|"pass"|"granted"|"block", reason?: string, grant?: object}}
 */
export function verdictSonarProof({ verdict, config, files, standingExceptions, generated }) {
  if (verdict.host === "kj-pipeline") {
    const stage = verdict.sonar;
    if (stage?.ran) return { ok: true, mode: "pass" };
    const why = stage ? `the pipeline's sonar stage did not run: ${stage.reason || "unknown reason"}` : "the pipeline verdict carries no sonar block";
    return { ok: false, mode: "block", reason: `Sonar is mandatory for code — ${why}` };
  }
  return checkSonarRequirement({ config, stagedFiles: files, sonar: verdict.sonar, standingExceptions, generated });
}
