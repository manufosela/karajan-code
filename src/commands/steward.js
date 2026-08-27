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
  evaluatePhantomCoverage, runInvariants,
} from "../steward/invariants.js";
import { loadPreviousAudit } from "../audit/basal-cost.js";
import { collectOsvFindings } from "../audit/osv-findings.js";
import { recordGateDecision } from "../policy/decisions.js";
import { syncProposedWork } from "../steward/proposed-work.js";

const stewardDir = (projectDir) => path.join(projectDir, ".karajan", "steward");

/** `gh run list` for push runs on the base branch — the sweep's default probe. */
const ghRuns = (projectDir, baseBranch) => () => {
  const out = execFileSync("gh", ["run", "list", "--branch", baseBranch, "--event", "push", "--limit", "30", "--json", "name,conclusion,createdAt"], { cwd: projectDir, encoding: "utf8", timeout: 30_000 });
  return JSON.parse(out).map((r) => ({ workflow: r.name, conclusion: r.conclusion, createdAt: r.createdAt }));
};

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

export async function stewardSweepCommand({ flags = {}, config = {}, logger = console, probes = {} } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const baseBranch = config.base_branch || "main";
  // STW-E (KJC-TSK-0793): --if-stale <days> — resuming work with a fresh
  // report does not re-sweep; the report in the repo stays the ONE source.
  if (flags.ifStale !== undefined) {
    const prev = readJson(path.join(stewardDir(projectDir), "report.json"));
    const ageMs = prev?.sweptAt ? (probes.nowMs ?? Date.now()) - Date.parse(prev.sweptAt) : Infinity;
    if (ageMs < Number(flags.ifStale) * 86_400_000) {
      logger.info?.(`steward: report is fresh (swept ${prev.sweptAt}) — not re-sweeping`);
      return 0;
    }
  }
  const freshness = resolveFreshness(config);
  const nowMs = probes.nowMs ?? Date.now();
  const runsFn = probes.runsFn ?? ghRuns(projectDir, baseBranch);

  // Live osv probe (best-effort): unavailable is null → the invariant answers
  // unknown with its remedy, never a clean bill.
  let vulns = probes.vulns ?? null;
  if (vulns === null) {
    try {
      const osv = await (probes.osvFn ?? collectOsvFindings)(projectDir, logger);
      if (osv?.available) vulns = (osv.vulnerabilities || []).map((v) => ({ id: v.id, severity: v.severity, publishedAt: v.publishedAt ?? null }));
    } catch { /* stays null — unknown */ }
  }

  // Dead-code baseline: the PREVIOUS report in the repo — shared memory.
  const prevReport = readJson(path.join(stewardDir(projectDir), "report.json"));
  const snapshot = await loadPreviousAudit(projectDir).catch(() => null);
  const deadNow = typeof snapshot?.knipDeadExports?.exports === "number"
    ? { deadExports: snapshot.knipDeadExports.exports + (snapshot.knipDeadExports.files || 0) }
    : Array.isArray(snapshot?.deadExports) ? { deadExports: snapshot.deadExports.length } : null;

  const invariants = [
    { id: "main-ci", renew: "push to the base branch (or fix the red run)", evaluate: () => evaluateMainCi({ projectDir, baseBranch, freshness: freshness.values, runsFn, nowMs }) },
    { id: "security-audit", renew: "kj audit --security", evaluate: () => evaluateSecurityAudit({ projectDir, freshness: freshness.values, nowMs }) },
    { id: "vulnerable-deps", renew: "kj audit (osv-scanner)", evaluate: () => evaluateVulnAging({ vulns, freshness: freshness.values, nowMs }) },
    { id: "dead-code-trend", renew: "kj audit (knip inventory)", evaluate: () => evaluateDeadCodeTrend({ current: deadNow, previous: prevReport?.deadCodeBaseline ?? null }) },
    { id: "coverage-config", renew: "configure a coverage threshold", evaluate: () => evaluateCoverageConfig({ projectDir }) },
    { id: "phantom-coverage", renew: "KJC-TSK-0800 ships the detectors", evaluate: () => evaluatePhantomCoverage() },
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
  const mark = { [VERDICTS.OK]: "✓", [VERDICTS.BROKEN]: "✗", [VERDICTS.UNKNOWN]: "?", [VERDICTS.NOT_OBSERVABLE]: "∅" };
  const md = [
    "# Steward report",
    "", `Last swept: ${report.sweptAt}`, "",
    `Freshness: ${freshness.declared ? "declared by the project" : "calibrated defaults (the project declared none)"} — ${Object.entries(freshness.values).map(([k, v]) => `${k}=${v}`).join(", ")}`, "",
    ...results.map((r) => [
      `## ${mark[r.verdict] || "?"} ${r.id} — ${r.verdict}`,
      `- evidence: ${r.evidence || "(none)"}`,
      ...(r.remedy ? [`- remedy: ${r.remedy}`] : []),
      `- renews with: ${r.renew}`, "",
    ]).flat(),
  ].join("\n");

  fs.mkdirSync(stewardDir(projectDir), { recursive: true });
  fs.writeFileSync(path.join(stewardDir(projectDir), "report.md"), md);
  fs.writeFileSync(path.join(stewardDir(projectDir), "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  // Every sweep is SEALED in the decision chain — the same criterion policy
  // decisions already meet: recorded and verifiable, not just notified.
  try {
    const counts = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    recordGateDecision(projectDir, { kind: "steward-sweep", verdicts: { ok: counts[VERDICTS.OK] || 0, broken: broken.length, unknown: counts[VERDICTS.UNKNOWN] || 0, "not-observable": counts[VERDICTS.NOT_OBSERVABLE] || 0 }, broken_ids: broken.map((b) => b.id) });
  } catch (err) { logger.warn?.(`⚠ steward: the sweep could not be sealed in the decision chain (${err.message})`); }

  // STW-D (KJC-TSK-0792): every break is PROPOSED work on the board the brain
  // already consumes. AFTER the report and the seal: a board failure never
  // costs either, and it is said loudly — never swallowed.
  try {
    const sync = await syncProposedWork({ projectDir, config, results, sweptAt: report.sweptAt });
    if (!sync.synced) logger.warn?.(`⚠ steward: broken invariants not carded — ${sync.reason}`);
    else if (sync.created || sync.updated || sync.resolved) logger.info?.(`steward board: ${sync.created} card(s) proposed, ${sync.updated} updated, ${sync.resolved} resolved`);
  } catch (err) { logger.warn?.(`⚠ steward: carding the broken invariants failed (${err.message}) — the report and the seal stand`); }

  // A report nobody can see is not shared state — say it, do not fix their tree.
  try {
    execFileSync("git", ["check-ignore", "-q", path.join(".karajan", "steward", "report.md")], { cwd: projectDir });
    logger.warn?.("⚠ steward: the report path is gitignored — untrack .karajan/steward from .gitignore so the state is shared");
  } catch { /* not ignored — good */ }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    for (const r of results) logger.info?.(`${mark[r.verdict]} ${r.id}: ${r.verdict}${r.verdict === VERDICTS.OK ? "" : ` — ${r.remedy || r.evidence}`}`);
    logger.info?.(broken.length ? `steward: ${broken.length} invariant(s) BROKEN — the report names them (.karajan/steward/report.md)` : "steward: nothing broken — the full state is in .karajan/steward/report.md");
  }
  process.exitCode = broken.length ? 1 : 0;
  return broken.length ? 1 : 0;
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
