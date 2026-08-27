/**
 * Steward invariants — the verdict kernel (STW-A, KJC-TSK-0789, epic
 * KJC-PCS-0081). Trust expires like permission does: a green that nobody has
 * re-earned is not a green. Every invariant answers ONE of four things:
 *
 *   ok             — evidence exists, fresh, and holds
 *   broken         — evidence exists and says it does not hold
 *   unknown        — the evidence EXPIRED or cannot be read → remedy: refresh
 *   not-observable — there was never anywhere to look → remedy: instrument
 *
 * The last two are the point (GREBLA: workflows fire ONLY on pull_request, so
 * "how many days has main been red" had no possible answer — and 21 days of
 * red E2E hid a 17-day production bug). Confusing either with ok is the false
 * green Karajan exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
export const VERDICTS = { OK: "ok", BROKEN: "broken", UNKNOWN: "unknown", NOT_OBSERVABLE: "not-observable" };
// Defaults CALIBRATED with GREBLA's measured decay (79 days without a security
// audit; 21 days of red suite; 17 of them hiding a production bug). A project
// can declare its own under steward.freshness — and AC8: when the defaults
// apply, the report says so and says which values they are.
export const DEFAULT_FRESHNESS = { main_ci_red_days: 3, security_audit_days: 14, critical_vuln_days: 7, high_vuln_days: 30 };
/** @returns {{values: object, declared: boolean}} */
export function resolveFreshness(config = {}) {
  const declared = config?.steward?.freshness && typeof config.steward.freshness === "object" ? config.steward.freshness : null;
  return { values: { ...DEFAULT_FRESHNESS, ...(declared || {}) }, declared: Boolean(declared) };
}
/** Does any workflow run ON PUSH to the base branch? Reading the repo decides
 * observability — a remote API cannot tell "green" from "nobody looked". */
function pushWorkflows(projectDir, baseBranch) {
  const dir = path.join(projectDir, ".github", "workflows");
  let names;
  try { names = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)); } catch { return []; }
  const hits = [];
  for (const name of names) {
    let wf;
    try { wf = parseYaml(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
    // YAML 1.1 quirk: `on:` may parse as boolean true key.
    const on = wf?.on ?? wf?.[true];
    const push = Array.isArray(on) ? (on.includes("push") ? {} : null) : typeof on === "string" ? (on === "push" ? {} : null) : (on?.push ?? null);
    if (push === null || push === undefined) continue;
    const branches = push?.branches;
    if (!branches || (Array.isArray(branches) && branches.includes(baseBranch))) hits.push(wf?.name || name);
  }
  return hits;
}
const days = (ms) => Math.floor(ms / 86_400_000);
const plural = (n) => `${n} day${n === 1 ? "" : "s"}`;
/**
 * Invariant #1 — the base branch has CI of its own and it is green.
 * `runsFn(workflows)` is injected (the sweep wires `gh run list`); it returns
 * [{workflow, conclusion, createdAt}] newest-first for push runs on the base.
 */
export function evaluateMainCi({ projectDir, baseBranch = "main", freshness = DEFAULT_FRESHNESS, runsFn = null, nowMs = Date.now() }) {
  const instrumented = pushWorkflows(projectDir, baseBranch);
  if (instrumented.length === 0) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `no workflow runs on push to ${baseBranch} — "how long has it been red" has no possible answer`, remedy: `instrument: add a push trigger for ${baseBranch} to at least one workflow` };
  }
  let runs;
  try { runs = runsFn ? runsFn(instrumented) : null; } catch { runs = null; }
  if (!Array.isArray(runs) || runs.length === 0) {
    return { verdict: VERDICTS.UNKNOWN, evidence: `instrumented (${instrumented.join(", ")}) but the runs could not be read`, remedy: "refresh: run the sweep where gh can list the runs" };
  }
  const sorted = [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = sorted[0];
  if (latest.conclusion === "success") {
    return { verdict: VERDICTS.OK, evidence: `green on ${baseBranch} since ${latest.createdAt}`, remedy: null };
  }
  // The streak starts at the FIRST red after the last green — not at the green.
  const greenIdx = sorted.findIndex((r) => r.conclusion === "success");
  const firstRed = greenIdx === -1 ? sorted.at(-1) : sorted[greenIdx - 1];
  const redDays = days(nowMs - Date.parse(firstRed.createdAt));
  if (redDays > freshness.main_ci_red_days) {
    return { verdict: VERDICTS.BROKEN, evidence: `${baseBranch} red for ${plural(redDays)} (tolerance ${freshness.main_ci_red_days}) — a suite this red stops meaning anything`, remedy: "fix or revert to green; a red suite is the project's #1 invariant" };
  }
  return { verdict: VERDICTS.OK, evidence: `red for ${plural(redDays)}, inside the ${freshness.main_ci_red_days}-day tolerance — a fresh failure is work, not decay`, remedy: null };
}
/**
 * Run a list of invariants. A child whose `dependsOn` parent came out
 * not-observable INHERITS it — an invariant built on an unobserved one must
 * never report ok. A probe that throws is unknown: never a green light.
 */
export function runInvariants(invariants, ctx = {}) {
  const results = [];
  const byId = new Map();
  for (const inv of invariants) {
    const parent = inv.dependsOn ? byId.get(inv.dependsOn) : null;
    let res;
    if (parent && parent.verdict === VERDICTS.NOT_OBSERVABLE) {
      res = { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `depends on ${inv.dependsOn}, which is not observable`, remedy: `instrument ${inv.dependsOn} first (${parent.remedy || "no remedy stated"})` };
    } else {
      try { res = inv.evaluate(ctx); } catch (err) { res = { verdict: VERDICTS.UNKNOWN, evidence: `the probe itself failed (${err.message})`, remedy: "fix the probe — a broken probe is never a green light" }; }
    }
    const row = { id: inv.id, ...res };
    byId.set(inv.id, row);
    results.push(row);
  }
  return results;
}
