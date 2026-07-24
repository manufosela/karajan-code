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

  return {
    commits: { total: subjects.length, withCard: subjects.filter((s) => CARD_REF_RE.test(s)).length },
    verdicts: { total: verdicts.length, stamped: stamped.length, root: stamped.filter((v) => v.workspace === "root").length },
    testless: { sampled: blocks.length, offenders },
  };
}

export function formatMethodStats(s) {
  return `commits with card ref ${s.commits.withCard}/${s.commits.total} · verdict workspaces root ${s.verdicts.root}/${s.verdicts.stamped || 0} stamped (${s.verdicts.total} total) · source commits without tests ${s.testless.offenders}/${s.testless.sampled}`;
}

function createMethodCheck() {
  return {
    name: "method",
    label: "Method adherence (recent history)",
    strategy: STRATEGY.NONE,
    async detect({ config = {}, projectDir = process.cwd(), run = runCommand } = {}) {
      const stats = await collectMethodStats({ projectDir, run, sample: config.method_gates?.report_sample || 20 });
      const detail = formatMethodStats(stats);
      const drought = stats.commits.total >= 5 && stats.commits.withCard / stats.commits.total < 0.5;
      if (drought) {
        return { ok: false, severity: "warn", detail: `most recent commits carry no card reference — ${detail}` };
      }
      return { ok: true, severity: "info", detail };
    },
  };
}

export function getMethodChecks() {
  return [createMethodCheck()];
}
