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
import { ciCoverageWorkflows, coverageOnByDefault } from "./ci-coverage.js";
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
  // Each workflow is judged on its own: a green run of one must not hide a red one of another.
  const groups = Object.values(Object.groupBy(runs, workflowKey));
  const judged = groups.map((group) => judgeWorkflow(group, { baseBranch, freshness, nowMs }));
  const broken = judged.filter((j) => j.broken);
  if (broken.length > 0) {
    return { verdict: VERDICTS.BROKEN, evidence: broken.map((j) => `${j.name}: ${j.evidence}`).join("; "), remedy: `fix or revert to green: ${broken.map((j) => j.name).join(", ")}; a red suite is the project's #1 invariant` };
  }
  const pick = judged.find((j) => j.red) ?? judged.toSorted((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))[0];
  return { verdict: VERDICTS.OK, evidence: pick.evidence, remedy: null };
}
// `gh run list --json name` names the workflow in `name`; the others are kept for injected probes.
const workflowKey = (r) => String(r.name ?? r.workflowName ?? r.workflow ?? r.workflowId ?? "(unnamed)");
/** One workflow's runs → its own verdict, by its latest run and red streak. */
function judgeWorkflow(group, { baseBranch, freshness, nowMs }) {
  const sorted = [...group].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = sorted[0];
  const base = { name: workflowKey(latest), latestAt: latest.createdAt };
  if (latest.conclusion === "success") {
    return { ...base, red: false, broken: false, evidence: `green on ${baseBranch} since ${latest.createdAt}` };
  }
  // The streak starts at the FIRST red after the last green — not at the green.
  const greenIdx = sorted.findIndex((r) => r.conclusion === "success");
  const firstRed = greenIdx === -1 ? sorted.at(-1) : sorted[greenIdx - 1];
  const redDays = days(nowMs - Date.parse(firstRed.createdAt));
  if (redDays > freshness.main_ci_red_days) {
    return { ...base, red: true, broken: true, evidence: `${baseBranch} red for ${plural(redDays)} (tolerance ${freshness.main_ci_red_days}) — a suite this red stops meaning anything` };
  }
  return { ...base, red: true, broken: false, evidence: `red for ${plural(redDays)}, inside the ${freshness.main_ci_red_days}-day tolerance — a fresh failure is work, not decay` };
}
/** Where `kj audit` records its last run for the Steward to age. */
export const securityAuditMarkerPath = (projectDir) => path.join(projectDir, ".karajan", "steward", "security-audit.json");
/**
 * AC5 — how long since `kj audit --security` last ran. "Never" is GREBLA's
 * real case: 79 days with an open redirect and untouched dependencies.
 * No record is BROKEN, not unknown: running the audit fixes both "never"
 * and "before recording existed", so the remedy is the same either way.
 */
export function evaluateSecurityAudit({ projectDir, freshness = DEFAULT_FRESHNESS, nowMs = Date.now() }) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(securityAuditMarkerPath(projectDir), "utf8")); } catch { marker = null; }
  if (!marker?.at) {
    return { verdict: VERDICTS.BROKEN, evidence: "no security audit on record — never run, or run before recording existed", remedy: "run kj audit --security (zero tokens) and remediate what it finds" };
  }
  const age = days(nowMs - Date.parse(marker.at));
  if (age > freshness.security_audit_days) {
    return { verdict: VERDICTS.BROKEN, evidence: `last security audit ${plural(age)} ago (freshness ${freshness.security_audit_days})`, remedy: "run kj audit --security" };
  }
  return { verdict: VERDICTS.OK, evidence: `security audit ${plural(age)} ago (${marker.at})`, remedy: null };
}
/**
 * AC6 — vulnerable dependencies age by the ADVISORY's published date, never
 * the discovery's: the clock started when the world knew. A critical with no
 * date counts as overdue — unknown age is not youth.
 */
export function evaluateVulnAging({ vulns, freshness = DEFAULT_FRESHNESS, nowMs = Date.now() }) {
  if (!Array.isArray(vulns)) {
    return { verdict: VERDICTS.UNKNOWN, evidence: "no vulnerability scan handed to the invariant", remedy: "refresh: run kj audit so osv-scanner reports the dependencies" };
  }
  const windowFor = (sev) => (sev === "CRITICAL" ? freshness.critical_vuln_days : sev === "HIGH" ? freshness.high_vuln_days : null);
  const overdue = vulns.filter((v) => {
    const win = windowFor(String(v.severity || "").toUpperCase());
    if (win === null) return false;
    if (!v.publishedAt) return true;
    return days(nowMs - Date.parse(v.publishedAt)) > win;
  });
  if (overdue.length > 0) {
    const items = overdue.map((v) => `${v.id} (${v.severity}, advisory ${v.publishedAt || "date unknown — unknown age is not youth"})`).join("; ");
    return { verdict: VERDICTS.BROKEN, evidence: `${overdue.length} vulnerable dependencies past their advisory-age window: ${items}`, remedy: "update or replace the affected packages" };
  }
  return { verdict: VERDICTS.OK, evidence: `${vulns.length} known vulnerabilities, all inside their advisory-age windows`, remedy: null };
}
/**
 * AC4 — dead code informs by DERIVATIVE and carries NO security weight: in
 * GREBLA the sensitive functions stayed in the bundle, but the backend rules
 * kept protecting them — removing UI neither widened nor closed any surface.
 * Growth is the decay signal; the absolute is somebody else's report.
 */
export function evaluateDeadCodeTrend({ current, previous }) {
  if (!current || typeof current.deadExports !== "number") {
    return { verdict: VERDICTS.UNKNOWN, evidence: "no dead-code measurement on record", remedy: "refresh: run kj audit so the inventory is measured" };
  }
  if (!previous || typeof previous.deadExports !== "number") {
    return { verdict: VERDICTS.OK, evidence: `${current.deadExports} dead exports — first measurement, the trend starts here`, remedy: null };
  }
  const delta = current.deadExports - previous.deadExports;
  if (delta > 0) {
    return { verdict: VERDICTS.BROKEN, evidence: `dead code grew +${delta} since ${previous.timestamp || "the last audit"} (now ${current.deadExports}; no security weight — dead code is debt, not attack surface)`, remedy: "delete what the inventory names, or declare the false positives" };
  }
  return { verdict: VERDICTS.OK, evidence: `dead code ${delta === 0 ? "flat" : delta} since the last audit (now ${current.deadExports})`, remedy: null };
}
/** How far after `coverage` a threshold key is still attributed to it. 400 missed
 *  grebla's real config (#3604: 527 chars); 800 finds it with no false ok. */
const COVERAGE_THRESHOLD_WINDOW = 800;
const COVERAGE_THRESHOLD_RE = new RegExp(String.raw`coverage[\s\S]{0,${COVERAGE_THRESHOLD_WINDOW}}?(thresholds?|lines|branches|functions|statements)\s*[:=]`);
const COVERAGE_CONFIGS = ["vitest.config.js", "vitest.config.ts", "vitest.config.mjs", "jest.config.js", "jest.config.ts", "jest.config.json", "package.json"];
/**
 * AC7 — coverage is an invariant of CONFIGURATION, not of value: no 80% is
 * demanded here. Either something measures the level (CI's job), or nothing
 * does — and "nothing measures it" is the definition of not observable.
 */
export function evaluateCoverageConfig({ projectDir }) {
  for (const name of COVERAGE_CONFIGS) {
    let text;
    try { text = fs.readFileSync(path.join(projectDir, name), "utf8"); } catch { continue; }
    if (COVERAGE_THRESHOLD_RE.test(text)) return judgeThresholdInCi(projectDir, name, coverageOnByDefault(text, name));
  }
  return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: "no coverage threshold configured anywhere — nothing measures the level", remedy: "instrument: configure a coverage threshold (any value the team stands behind — no 80% is demanded)" };
}
/** A configured threshold only counts when some CI workflow applies it. */
function judgeThresholdInCi(projectDir, configName, alwaysOn) {
  const { workflows, covering } = ciCoverageWorkflows(projectDir, { alwaysOn });
  if (workflows.length === 0) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `coverage thresholds configured in ${configName}, but there are no CI workflows to check`, remedy: "instrument: add a CI workflow that runs the tests with coverage" };
  }
  if (covering.length === 0) {
    return { verdict: VERDICTS.BROKEN, evidence: `the threshold in ${configName} is never applied: no CI workflow runs the tests with coverage`, remedy: "run the tests with coverage in CI (e.g. vitest run --coverage)" };
  }
  return { verdict: VERDICTS.OK, evidence: `coverage thresholds configured in ${configName} and applied by ${covering.join(", ")} — the level itself is CI's job`, remedy: null };
}
/** AC3 — phantom coverage: the sweep (KJC-TSK-1343) runs the two detectors
 * (KJC-TSK-0800) over the test↔source pairs and hands their output in.
 * No output → not observable, with the sweep's reason: never ok by absence. */
export function evaluatePhantomCoverage({ phantoms, reason } = {}) {
  if (!Array.isArray(phantoms)) {
    if (reason) return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: reason, remedy: "the detectors read Lit components in a git repository; until the project has them this invariant cannot be observed" };
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: "the phantom detectors were not run", remedy: "instrument: run the detectors (steward/phantom-coverage) over the suite's test↔source pairs and feed their output" };
  }
  if (phantoms.length > 0) {
    return { verdict: VERDICTS.BROKEN, evidence: `${phantoms.length} phantom test(s): ${phantoms.map((p) => p.literal || p.member).join(", ")} — they add to the count and cover nothing`, remedy: "rewrite each test against the live UI, or delete it with the dead code it exercised" };
  }
  return { verdict: VERDICTS.OK, evidence: "no phantom tests in the detectors' output", remedy: null };
}
/** KJC-TSK-1515 — duplicate class members: JS keeps the LAST definition, the
 * first silently stops running. `results` = per-file output of findDuplicateMembers. */
export function evaluateDuplicateMembers({ results } = {}) {
  const remedy = "remove or rename the duplicate; the last definition silently wins";
  const unparsed = (results ?? []).filter((r) => r.observable === false).map((r) => r.file);
  const analysed = (results ?? []).filter((r) => r.observable !== false);
  const found = analysed.flatMap((r) => r.duplicates.map((d) => ({ file: r.file, ...d })));
  const note = unparsed.length > 0 ? ` (could not parse: ${unparsed.join(", ")})` : "";
  if (found.length > 0) {
    const shown = found.slice(0, 3).map((d) => `${d.file}:${d.lines.join("/")} ${d.class}.${d.member}`).join("; ");
    return { verdict: VERDICTS.BROKEN, evidence: `${found.length} duplicate member(s): ${shown}${found.length > 3 ? "; …" : ""}${note}`, remedy };
  }
  if (analysed.length === 0) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `no source file could be analysed${note}`, remedy: "run the sweep in a git repository with JS/TS sources" };
  }
  // A sweep with files it could not read is incomplete: never reported clean.
  if (unparsed.length > 0) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `${analysed.length} file(s) analysed without duplicates, but ${unparsed.length} could not be parsed${note}`, remedy: "fix or exclude the files that do not parse" };
  }
  return { verdict: VERDICTS.OK, evidence: `${analysed.length} file(s) analysed, no class defines a member twice${note}`, remedy: null };
}
/** `gh pr list` statusCheckRollup → [{name, conclusion, completedAt}]; CheckRun and StatusContext. */
export function mapStatusCheckRollup(rollup) {
  return (Array.isArray(rollup) ? rollup : []).map((c) => {
    const conclusion = c.conclusion || c.state || null;
    // A StatusContext has no completedAt: once terminal, its own timestamp (startedAt or createdAt) is when it ended.
    const done = c.completedAt || (c.state && c.state !== "PENDING" ? (c.startedAt ?? c.createdAt) : null);
    // gh prints the zero time for a check that never finished.
    return { name: c.name ?? c.context ?? "(unnamed)", conclusion, completedAt: done && !done.startsWith("0001") ? done : null };
  });
}
// Allowlist: any other conclusion (failure, action_required, stale, startup_failure...) is unverified.
const GOOD_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
// A check re-run keeps its earlier runs in the rollup: only the latest run of each name counts.
const finishedMs = (c) => (c.completedAt ? Date.parse(c.completedAt) : Infinity);
function latestPerName(checks) {
  const byName = new Map();
  for (const c of checks ?? []) {
    const prev = byName.get(c.name);
    if (!prev || finishedMs(c) >= finishedMs(prev)) byName.set(c.name, c);
  }
  return [...byName.values()];
}
/** Why a merged PR was unverified (first reason found), or null when its checks were done and fine before the merge. */
function unverifiedReason(pr) {
  const mergedMs = Date.parse(pr.mergedAt);
  for (const c of latestPerName(pr.checks)) {
    if (!c.completedAt) return `${c.name}: never finished`;
    if (Date.parse(c.completedAt) > mergedMs) return `${c.name}: finished after the merge`;
    if (!GOOD_CONCLUSIONS.has(String(c.conclusion).toLowerCase())) return `${c.name}: ${String(c.conclusion).toLowerCase()}`;
  }
  return null;
}
/** Steward invariant — a PR merged before its checks finished (or red) was never verified (KJC-TSK-1516). */
export function evaluateMergedUnverified({ prs, windowDays = 14, nowMs = Date.now(), reason, truncated = false } = {}) {
  if (!Array.isArray(prs)) {
    const why = reason ? " (" + reason + ")" : "";
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `merged PRs could not be read${why}`, remedy: "instrument: run the sweep where gh can list the merged PRs" };
  }
  const recent = prs.filter((p) => nowMs - Date.parse(p.mergedAt) <= windowDays * 86_400_000);
  if (recent.length === 0) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `no PR merged in the last ${windowDays} days`, remedy: "nothing to observe until a PR is merged" };
  }
  const bad = recent.map((p) => ({ number: p.number, why: unverifiedReason(p) })).filter((p) => p.why);
  // A full page may have left merges of the window out: what was read is fine, the rest is unseen.
  if (bad.length === 0 && truncated) {
    return { verdict: VERDICTS.NOT_OBSERVABLE, evidence: `the ${recent.length} PR(s) read are verified, but the read hit its limit and older merges of the ${windowDays} days are unseen`, remedy: "run the sweep more often than the merge rate fills the read" };
  }
  if (bad.length === 0) {
    return { verdict: VERDICTS.OK, evidence: `${recent.length} PR(s) merged in ${windowDays} days, all with their checks complete and green`, remedy: null };
  }
  const named = bad.slice(0, 3).map((p) => `#${p.number} (${p.why})`).join("; ");
  return { verdict: VERDICTS.BROKEN, evidence: `${bad.length} of ${recent.length} merged PR(s) unverified: ${named}`, remedy: "merge only when the PR's required checks are green: require them in branch protection" };
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
