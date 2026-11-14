/**
 * `kj steward sweep` (STW-B, KJC-TSK-0790, epic KJC-PCS-0081) — a READ-ONLY
 * pass over the Steward invariants that leaves the verdict IN THE REPO:
 * `.karajan/steward/report.md` (a person: verdict, last evidence, and the
 * command that renews each invariant) and `report.json` (a machine — and the
 * BASELINE the next sweep compares against: the versioned report is the
 * shared memory, never a record on one machine). Exit 1 only when something
 * is BROKEN — unknown and not-observable inform with their remedy.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  VERDICTS, resolveFreshness, evaluateMainCi, evaluateSecurityAudit,
  evaluateVulnAging, evaluateDeadCodeTrend, evaluateCoverageConfig,
  evaluatePhantomCoverage, evaluateDuplicateMembers, evaluateMergedUnverified, mapStatusCheckRollup,
  evaluateAgentWorktreesExcluded, runInvariants,
} from "../steward/invariants.js";
import { baseBranchFrom } from "../config/base-branch.js";
import { loadPreviousAudit } from "../audit/basal-cost.js";
import { collectOsvFindings } from "../audit/osv-findings.js";
import { recordGateDecision } from "../policy/decisions.js";
import { syncProposedWork } from "../steward/proposed-work.js";
import { sweepPhantoms, sweepDuplicateMembers } from "../steward/phantom-sweep.js";
import { sweepRunnerExcludes } from "../steward/runner-excludes.js";
import { benchDetector } from "../steward/history-bench.js";
import { probeEmbedderLoad, evaluateEmbedderLoad } from "../checks/embedder-load.js";

const stewardDir = (projectDir) => path.join(projectDir, ".karajan", "steward");

/** `gh run list` for push runs on the base branch — the sweep's default probe. */
const ghRuns = (projectDir, baseBranch) => () => {
  const out = execFileSync("gh", ["run", "list", "--branch", baseBranch, "--event", "push", "--limit", "30", "--json", "name,conclusion,createdAt"], { cwd: projectDir, encoding: "utf8", timeout: 30_000 });
  return JSON.parse(out).map((r) => ({ workflow: r.name, conclusion: r.conclusion, createdAt: r.createdAt }));
};

const MERGED_WINDOW_DAYS = 14;
const MERGED_LIMIT = 300;
/** Every PR merged into the base inside the window, with its checks — the merged-unverified probe. */
const ghMergedPrs = (projectDir, baseBranch, nowMs) => () => {
  const since = new Date(nowMs - MERGED_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const args = ["pr", "list", "--state", "merged", "--base", baseBranch, "--search", `merged:>=${since}`, "--limit", String(MERGED_LIMIT), "--json", "number,mergedAt,statusCheckRollup"];
  const out = execFileSync("gh", args, { cwd: projectDir, encoding: "utf8", timeout: 60_000 });
  return JSON.parse(out).map((p) => ({ number: p.number, mergedAt: p.mergedAt, checks: mapStatusCheckRollup(p.statusCheckRollup) }));
};

/** Merged PRs via the probe; a failing gh is said (reason), never a clean list; a full page may be missing some. */
function mergedPrsProbe(projectDir, baseBranch, probes, nowMs) {
  try {
    const prs = (probes.mergedPrs ?? ghMergedPrs(projectDir, baseBranch, nowMs))();
    return { prs, truncated: prs.length >= MERGED_LIMIT, windowDays: MERGED_WINDOW_DAYS };
  } catch (err) { return { prs: null, reason: err.message }; }
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

const MARK = { [VERDICTS.OK]: "✓", [VERDICTS.BROKEN]: "✗", [VERDICTS.UNKNOWN]: "?", [VERDICTS.NOT_OBSERVABLE]: "∅" };

/**
 * STW-E (KJC-TSK-0793): --if-stale <days> — resuming work with a fresh
 * report does not re-sweep; the report in the repo stays the ONE source.
 * @returns {object|null} the fresh previous report, or null when a sweep is due
 */
function freshReport(projectDir, flags, probes) {
  if (flags.ifStale === undefined) return null;
  const prev = readJson(path.join(stewardDir(projectDir), "report.json"));
  const ageMs = prev?.sweptAt ? (probes.nowMs ?? Date.now()) - Date.parse(prev.sweptAt) : Infinity;
  return ageMs < Number(flags.ifStale) * 86_400_000 ? prev : null;
}

/**
 * Live osv probe (best-effort): unavailable is null → the invariant answers
 * unknown with its remedy, never a clean bill.
 */
async function liveVulns({ projectDir, logger, probes }) {
  if (probes.vulns != null) return probes.vulns;
  try {
    const osv = await (probes.osvFn ?? collectOsvFindings)(projectDir, logger);
    if (osv?.available) return (osv.vulnerabilities || []).map((v) => ({ id: v.id, severity: v.severity, publishedAt: v.publishedAt ?? null }));
  } catch { /* stays null — unknown */ }
  return null;
}

/** The dead code the last audit counted: knip's exports + files, or the older deadExports list. */
async function deadCodeNow(projectDir) {
  const snapshot = await loadPreviousAudit(projectDir).catch(() => null);
  if (typeof snapshot?.knipDeadExports?.exports === "number") {
    return { deadExports: snapshot.knipDeadExports.exports + (snapshot.knipDeadExports.files || 0) };
  }
  return Array.isArray(snapshot?.deadExports) ? { deadExports: snapshot.deadExports.length } : null;
}

/** The phantom detectors over the project's test↔source pairs; a failure is said, never clean. */
function phantomSweep(projectDir, probes) {
  if (probes.phantoms) return probes.phantoms;
  try { return sweepPhantoms({ projectDir }); } catch (err) { return { reason: `the phantom sweep failed (${err.message})` }; }
}

/** Classes that define one member twice; a throw becomes UNKNOWN in runInvariants, never clean. */
const duplicateMembersSweep = (projectDir, probes) => probes.duplicateMembers ?? sweepDuplicateMembers({ projectDir });

export async function stewardSweepCommand({ flags = {}, config = {}, logger = console, probes = {} } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const baseBranch = baseBranchFrom({ config, projectDir, label: "kj steward" });
  const fresh = freshReport(projectDir, flags, probes);
  if (fresh) {
    logger.info?.(`steward: report is fresh (swept ${fresh.sweptAt}) — not re-sweeping`);
    return 0;
  }
  const freshness = resolveFreshness(config);
  const nowMs = probes.nowMs ?? Date.now();
  const runsFn = probes.runsFn ?? ghRuns(projectDir, baseBranch);
  const vulns = await liveVulns({ projectDir, logger, probes });
  // Dead-code baseline: the PREVIOUS report in the repo — shared memory.
  const prevReport = readJson(path.join(stewardDir(projectDir), "report.json"));
  const deadNow = await deadCodeNow(projectDir);
  const embedder = await (probes.embedderLoad ?? probeEmbedderLoad(config).catch(() => null));

  const invariants = [
    { id: "main-ci", renew: "push to the base branch (or fix the red run)", evaluate: () => evaluateMainCi({ projectDir, baseBranch, freshness: freshness.values, runsFn, nowMs }) },
    { id: "security-audit", renew: "kj audit --security", evaluate: () => evaluateSecurityAudit({ projectDir, freshness: freshness.values, nowMs }) },
    { id: "vulnerable-deps", renew: "kj audit (osv-scanner)", evaluate: () => evaluateVulnAging({ vulns, freshness: freshness.values, nowMs }) },
    { id: "dead-code-trend", renew: "kj audit (knip inventory)", evaluate: () => evaluateDeadCodeTrend({ current: deadNow, previous: prevReport?.deadCodeBaseline ?? null }) },
    { id: "coverage-config", renew: "configure a coverage threshold", evaluate: () => evaluateCoverageConfig({ projectDir }) },
    { id: "phantom-coverage", renew: "kj steward sweep (runs the phantom detectors)", evaluate: () => evaluatePhantomCoverage(phantomSweep(projectDir, probes)) },
    { id: "duplicate-members", renew: "kj steward sweep", evaluate: () => evaluateDuplicateMembers(duplicateMembersSweep(projectDir, probes)) },
    { id: "runner-collects-agent-worktrees", renew: "exclude agent worktrees in the test runner config", evaluate: () => evaluateAgentWorktreesExcluded(sweepRunnerExcludes(projectDir)) },
    { id: "embedder-load", renew: "kj doctor (embedder-load)", evaluate: () => evaluateEmbedderLoad(embedder) },
    { id: "merged-unverified", renew: "merge with required checks green", evaluate: () => evaluateMergedUnverified({ ...mergedPrsProbe(projectDir, baseBranch, probes, nowMs), nowMs }) },
  ];
  const results = runInvariants(invariants, {}).map((r, i) => ({ ...r, renew: invariants[i].renew }));
  const broken = results.filter((r) => r.verdict === VERDICTS.BROKEN);

  const report = {
    sweptAt: new Date(nowMs).toISOString(),
    baseBranch,
    freshness: { ...freshness.values, declared: freshness.declared },
    invariants: results,
    deadCodeBaseline: deadNow ? { ...deadNow, timestamp: new Date(nowMs).toISOString() } : (prevReport?.deadCodeBaseline ?? null),
  };
  writeReport(projectDir, report, freshness);
  sealSweep({ projectDir, results, broken, logger });
  await cardBrokenInvariants({ projectDir, config, results, sweptAt: report.sweptAt, logger });
  warnIfReportIgnored(projectDir, logger);
  printSweep({ flags, report, results, broken, logger });
  process.exitCode = broken.length ? 1 : 0;
  return broken.length ? 1 : 0;
}

function writeReport(projectDir, report, freshness) {
  const freshnessValues = Object.entries(freshness.values).map(([k, v]) => `${k}=${v}`).join(", ");
  const md = [
    "# Steward report",
    "", `Last swept: ${report.sweptAt}`, "",
    `Freshness: ${freshness.declared ? "declared by the project" : "calibrated defaults (the project declared none)"} — ${freshnessValues}`, "",
    ...report.invariants.flatMap((r) => [
      `## ${MARK[r.verdict] || "?"} ${r.id} — ${r.verdict}`,
      `- evidence: ${r.evidence || "(none)"}`,
      ...(r.remedy ? [`- remedy: ${r.remedy}`] : []),
      `- renews with: ${r.renew}`, "",
    ]),
  ].join("\n");
  fs.mkdirSync(stewardDir(projectDir), { recursive: true });
  fs.writeFileSync(path.join(stewardDir(projectDir), "report.md"), md);
  fs.writeFileSync(path.join(stewardDir(projectDir), "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

/** `kj steward bench` (HU-3791) — prints the measure; it never judges, so the exit is 0. */
export function stewardBenchCommand({ flags = {}, logger = console } = {}) {
  const result = benchDetector({ repoDir: flags.repo || process.cwd(), range: flags.range, detector: flags.detector });
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  const first = result.firstFiring ? `first fired at ${result.firstFiring.sha} (commit ${result.firstFiring.index + 1} of ${result.commits})` : "never fired";
  logger.info?.(`steward bench: ${result.detector} over ${result.commits} commit(s): ${first}; fired on ${result.firings}`);
  return 0;
}

/**
 * Every sweep is SEALED in the decision chain — the same criterion policy
 * decisions already meet: recorded and verifiable, not just notified.
 */
function sealSweep({ projectDir, results, broken, logger }) {
  try {
    const counts = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    recordGateDecision(projectDir, { kind: "steward-sweep", verdicts: { ok: counts[VERDICTS.OK] || 0, broken: broken.length, unknown: counts[VERDICTS.UNKNOWN] || 0, "not-observable": counts[VERDICTS.NOT_OBSERVABLE] || 0 }, broken_ids: broken.map((b) => b.id) });
  } catch (err) { logger.warn?.(`⚠ steward: the sweep could not be sealed in the decision chain (${err.message})`); }
}

/**
 * STW-D (KJC-TSK-0792): every break is PROPOSED work on the board the brain
 * already consumes. AFTER the report and the seal: a board failure never
 * costs either, and it is said loudly — never swallowed.
 */
async function cardBrokenInvariants({ projectDir, config, results, sweptAt, logger }) {
  try {
    const sync = await syncProposedWork({ projectDir, config, results, sweptAt });
    if (!sync.synced) {
      logger.warn?.(`⚠ steward: broken invariants not carded — ${sync.reason}`);
      return;
    }
    if (!(sync.created || sync.updated || sync.resolved)) return;
    logger.info?.(`steward board: ${sync.created} card(s) proposed, ${sync.updated} updated, ${sync.resolved} resolved`);
    if (sync.replicateIn) logger.info?.(`→ replicate them in ${sync.replicateIn} through your agent's board tools (kj hu list shows them)`);
  } catch (err) { logger.warn?.(`⚠ steward: carding the broken invariants failed (${err.message}) — the report and the seal stand`); }
}

/** A report nobody can see is not shared state — say it, do not fix their tree. */
function warnIfReportIgnored(projectDir, logger) {
  try {
    execFileSync("git", ["check-ignore", "-q", path.join(".karajan", "steward", "report.md")], { cwd: projectDir });
    logger.warn?.("⚠ steward: the report path is gitignored — untrack .karajan/steward from .gitignore so the state is shared");
  } catch { /* not ignored — good */ }
}

function printSweep({ flags, report, results, broken, logger }) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  for (const r of results) {
    const why = r.verdict === VERDICTS.OK ? "" : ` — ${r.remedy || r.evidence}`;
    logger.info?.(`${MARK[r.verdict]} ${r.id}: ${r.verdict}${why}`);
  }
  logger.info?.(broken.length ? `steward: ${broken.length} invariant(s) BROKEN — the report names them (.karajan/steward/report.md)` : "steward: nothing broken — the full state is in .karajan/steward/report.md");
}

/**
 * STW-E — the on-resume mode: when work resumes there is someone in front to
 * review the report, which is the requirement. Only for projects that ADOPTED
 * the Steward (a report exists, or method_gates.steward is declared): the
 * default imposes nothing. Best-effort: a failed sweep never stops a resume.
 */
export async function sweepOnResume({ config = {}, logger = console, sweepFn = stewardSweepCommand } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const adopted = fs.existsSync(path.join(stewardDir(projectDir), "report.json")) || Boolean(config.method_gates?.steward);
  if (!adopted) return;
  try { await sweepFn({ flags: { ifStale: 1 }, config, logger }); } catch (err) { logger.warn?.(`⚠ steward: on-resume sweep failed (${err.message}) — resuming anyway`); }
}
