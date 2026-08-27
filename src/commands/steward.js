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
  const freshness = resolveFreshness(config);
  const nowMs = probes.nowMs ?? Date.now();
  const runsFn = probes.runsFn ?? ghRuns(projectDir, baseBranch);

  // Dead-code baseline: the PREVIOUS report in the repo — shared memory.
  const prevReport = readJson(path.join(stewardDir(projectDir), "report.json"));
  const snapshot = await loadPreviousAudit(projectDir).catch(() => null);
  const deadNow = typeof snapshot?.knipDeadExports?.exports === "number"
    ? { deadExports: snapshot.knipDeadExports.exports + (snapshot.knipDeadExports.files || 0) }
    : Array.isArray(snapshot?.deadExports) ? { deadExports: snapshot.deadExports.length } : null;

  const invariants = [
    { id: "main-ci", renew: "push to the base branch (or fix the red run)", evaluate: () => evaluateMainCi({ projectDir, baseBranch, freshness: freshness.values, runsFn, nowMs }) },
    { id: "security-audit", renew: "kj audit --security", evaluate: () => evaluateSecurityAudit({ projectDir, freshness: freshness.values, nowMs }) },
    { id: "vulnerable-deps", renew: "kj audit (osv-scanner)", evaluate: () => evaluateVulnAging({ vulns: probes.vulns ?? null, freshness: freshness.values, nowMs }) },
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
