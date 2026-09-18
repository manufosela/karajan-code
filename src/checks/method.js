/**
 * Method report (KJC-TSK-0689, MG-D of épica KJC-PCS-0068). Individual
 * deviations can each be legitimate — the AGGREGATE trail is the drift
 * detector. Three measurable signals over the recent history: commit
 * subjects without a card reference, review verdicts by workspace
 * ([root] vs lanes), and source commits without a single test change.
 * Informative by design; only a card-ref drought turns it into a warn.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { checkTestsWithCode } from "../review/tests-with-code.js";
import { CARD_REF_RE } from "../review/card-first.js";
import { STRATEGY } from "./types.js";
import { createRagCoverageCheck } from "./rag-coverage.js";

function recentVerdicts(projectDir, sample) {
  try {
    const dir = path.join(projectDir, ".karajan", "reviews");
    return readdirSync(dir).filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, sample);
  } catch {
    return [];
  }
}

export async function collectMethodStats({ projectDir, run = runCommand, sample = 20 } = {}) {
  const subjectsRes = await run("git", ["log", `-${sample}`, "--no-merges", "--format=%s"], { cwd: projectDir });
  const subjects = subjectsRes.exitCode === 0 ? subjectsRes.stdout.split("\n").filter(Boolean) : [];

  // "@%h" carries a % so git treats it as a literal format string — a bare
  // "@" is rejected as an unknown pretty alias (caught in a live smoke).
  const blocksRes = await run("git", ["log", `-${Math.min(sample, 10)}`, "--no-merges", "--name-only", "--format=@%h"], { cwd: projectDir });
  const blocks = blocksRes.exitCode === 0
    ? blocksRes.stdout.split(/^@.*$/m).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length > 0)
    : [];
  const offenders = blocks.filter((files) => checkTestsWithCode({ config: {}, stagedFiles: files, env: {} }).mode !== "pass").length;

  const verdicts = recentVerdicts(projectDir, sample);
  const stamped = verdicts.filter((v) => v.workspace);
  const sonar = { proved: 0, docsOnly: 0, granted: 0, unproved: 0 };
  const rag = { proved: 0, docsOnly: 0, granted: 0, noHarness: 0, unproved: 0 };
  for (const v of verdicts) {
    const kind = sonarProof(v);
    if (kind) sonar[kind] += 1;
    const asked = ragProof(v);
    if (asked) rag[asked] += 1;
  }

  return {
    commits: { total: subjects.length, withCard: subjects.filter((s) => CARD_REF_RE.test(s)).length },
    verdicts: { total: verdicts.length, stamped: stamped.length, root: stamped.filter((v) => v.workspace === "root").length },
    testless: { sampled: blocks.length, offenders },
    sonar,
    rag,
  };
}

/**
 * KJC-TSK-0838 (ADR 2026-09-13): what a verdict's sonar block proves —
 * "proved" (ran and covered every source), "docsOnly", "granted" (a human
 * lifted the rule) or "unproved" (an approved verdict for code with no
 * analysis, a skipped pipeline stage, or a source the scan never saw).
 * A verdict without a block predates the ADR and counts as nothing.
 */
export function sonarProof(v) {
  const s = v?.sonar;
  if (!s || v.verdict !== "approved") return null;
  // A pipeline stamp has no mode: the stage ran, or it did not.
  if (s.source === "pipeline") return s.ran ? "proved" : "unproved";
  // A block without a mode was written before the requirement existed
  // (the block landed one PR before fail-closed): not retroactive either.
  if (!s.mode) return null;
  if (s.mode === "docs-only") return "docsOnly";
  if (s.mode === "granted") return "granted";
  if (s.ran && (s.uncovered || []).length === 0) return "proved";
  return "unproved";
}

/**
 * KJC-TSK-0849 (ADR 0010, RAG-C): what a verdict's rag block proves — the
 * session asked the RAG about every source ("proved"), the diff was
 * "docsOnly", a human "granted" the rule, the tree runs with "noHarness"
 * (no session ledger can exist), or "unproved": an approved verdict for
 * code whose block covers nothing, or was never written. A pipeline verdict
 * carries no block (its warn is sealed at commit) and a verdict older than
 * the requirement has none either: neither is retroactive.
 */
export function ragProof(v) {
  const r = v?.rag;
  if (!r || v.verdict !== "approved" || !r.mode) return null;
  if (r.mode === "docs-only") return "docsOnly";
  if (r.mode === "granted") return "granted";
  if (r.mode === "no-harness") return "noHarness";
  // A pass proves something only with real coverage: both lists present,
  // at least one source covered, none uncovered. Anything else is a claim.
  const covered = Array.isArray(r.covered) ? r.covered : null;
  const uncovered = Array.isArray(r.uncovered) ? r.uncovered : null;
  if (r.mode === "pass" && covered?.length > 0 && uncovered?.length === 0) return "proved";
  return "unproved";
}

export function formatMethodStats(s) {
  const sonar = s.sonar ? ` · sonar proof: ${s.sonar.proved} proved, ${s.sonar.docsOnly} docs-only, ${s.sonar.granted} granted, ${s.sonar.unproved} unproved` : "";
  const rag = s.rag ? ` · rag proof: ${s.rag.proved} proved, ${s.rag.docsOnly} docs-only, ${s.rag.granted} granted, ${s.rag.noHarness} no-harness, ${s.rag.unproved} unproved` : "";
  return `commits with card ref ${s.commits.withCard}/${s.commits.total} · verdict workspaces root ${s.verdicts.root}/${s.verdicts.stamped || 0} stamped (${s.verdicts.total} total) · source commits without tests ${s.testless.offenders}/${s.testless.sampled}${sonar}${rag}`;
}

function createMethodCheck() {
  return {
    name: "method",
    label: "Method adherence (recent history)",
    strategy: STRATEGY.NONE,
    async detect({ config = {}, projectDir = process.cwd(), run = runCommand } = {}) {
      const stats = await collectMethodStats({ projectDir, run, sample: config.method_gates?.report_sample || 20 });
      const detail = formatMethodStats(stats);
      // KJC-TSK-0838: an approved verdict for code without sonar proof is the
      // method in red, not a trend — the gate should have refused it.
      if (stats.sonar.unproved > 0) {
        return { ok: false, severity: "fail", detail: `${stats.sonar.unproved} approved verdict(s) without sonar proof — ${detail}` };
      }
      // KJC-TSK-0849 (ADR 0010): same for code the session never asked the RAG about.
      if (stats.rag.unproved > 0) {
        return { ok: false, severity: "fail", detail: `${stats.rag.unproved} approved verdict(s) without rag proof — ${detail}` };
      }
      const drought = stats.commits.total >= 5 && stats.commits.withCard / stats.commits.total < 0.5;
      if (drought) {
        return { ok: false, severity: "warn", detail: `most recent commits carry no card reference — ${detail}` };
      }
      return { ok: true, severity: "info", detail };
    },
  };
}

export function getMethodChecks() {
  // KJC-TSK-0850 (ADR 0010): a source the RAG index cannot see is a defect
  // of the method, not a preference — same family as sonar proof.
  return [createMethodCheck(), createRagCoverageCheck()];
}
