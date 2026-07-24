/**
 * `kj review --staged | --check | --range` (ENV-B1, KJC-TSK-0637) — the v4
 * cross-AI review gate. Unlike the legacy task-review mode, this reviews a
 * raw git diff with an AI DIFFERENT from the host agent and records the
 * verdict tied to the exact diff (verdict-store), so the pre-commit hook
 * (ENV-C) can verify it. Exit code 0 = approved, 1 = rejected/stale.
 */
import { runCommand } from "../utils/process.js";
import { checkVerdict } from "../review/verdict-store.js";
import { runOneShotReview } from "../review/one-shot-review.js";
import { runSolomonArbitration } from "../review/solomon-arbitration.js";
import { ensureGateTrackable } from "../review/gate-gitignore.js";
import { runSonarPregate, formatSonarFinding } from "../review/sonar-pregate.js";
import { checkCardFirst } from "../review/card-first.js";

// KJC-TSK-0686 (MG-A): card-first is a gate, not a habit. Runs on --staged
// (before spending sonar/reviewer effort) AND on --check — the pre-commit
// hook already calls --check, so existing projects gain the gate with a
// simple package update, no hook regeneration.
async function enforceCardFirst({ config, projectDir }) {
  const branchRes = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.stdout?.trim() || "HEAD";
  const card = await checkCardFirst({ config, projectDir, branch });
  if (card.mode === "warn") console.log(`⚠ card-first: ${card.reason}`);
  if (card.mode === "exempt" && card.reason.includes("KJ_ALLOW_NO_CARD")) console.log(`⚠ card-first exempt: ${card.reason}`);
  if (!card.ok) {
    console.log(`✗ card-first gate: ${card.reason}`);
    process.exitCode = 1;
  }
  return card;
}

// Raw git always — never a wrapped/compressing runner (KJC-BUG-0115).
async function rawDiff(range, extraArgs = []) {
  const args = range ? ["diff", range, ...extraArgs] : ["diff", "--cached", ...extraArgs];
  const res = await runCommand("git", args);
  if (res.exitCode !== 0) {
    throw new Error(res.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return res.stdout;
}

function printVerdict(record) {
  if (record.verdict === "approved") {
    const ws = record.workspace ? ` [${record.workspace}]` : "";
    console.log(`✓ APPROVED by ${record.reviewer} (diff ${record.diffHash.slice(0, 12)})${ws}`);
    if (record.summary) console.log(`  ${record.summary}`);
    return;
  }
  console.log(`✗ REJECTED by ${record.reviewer} — ${record.issues.length} blocking issue(s):`);
  for (const issue of record.issues) {
    let where = "";
    if (issue.file) {
      const line = issue.line ? `:${issue.line}` : "";
      where = ` [${issue.file}${line}]`;
    }
    console.log(`  - (${issue.severity || "high"})${where} ${issue.description || issue.id}`);
    if (issue.suggested_fix) console.log(`    fix: ${issue.suggested_fix}`);
  }
  console.log("Fix the issues and run `kj review --staged` again — the verdict is tied to the exact diff.");
}

/**
 * `kj solomon --position "<why>"` (AB-E, KJC-TSK-0651) — the brain asks a
 * third AI to arbitrate a rejected verdict it disagrees with. Exit 0 =
 * approve (gate opens), 1 = reject (obey the reviewer and fix).
 */
export async function solomonCommand({ config, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const diff = await rawDiff(flags.range);
  const res = await runSolomonArbitration({ diff, position: flags.position, config, logger, projectDir });
  if (res.ruling === "approve") {
    console.log(`⚖ Solomon (${res.solomon}) rules for the brain — verdict recorded, the gate is open.`);
  } else {
    const who = res.solomon ? ` (${res.solomon})` : "";
    console.log(`⚖ Solomon${who} rules for the reviewer — obey and fix:`);
  }
  if (res.reasoning) console.log(`  ${res.reasoning}`);
  process.exitCode = res.ruling === "approve" ? 0 : 1;
  return res;
}

export async function reviewGateCommand({ config, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();

  if (flags.installGate) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const marker = path.join(projectDir, ".karajan", "review-gate");
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, "# Cross-AI review gate enabled (ENV-C1). Commit this file so the whole team inherits the gate.\n");
    console.log("✓ review gate enabled — commits now require an approved cross-AI verdict (kj review --staged)");
    // KJC-TSK-0646: a `.karajan/` dir-exclude would silently keep the
    // contract out of git — rewrite it so the team actually inherits it.
    const gi = await ensureGateTrackable(projectDir);
    if (gi.changed) {
      console.log("✓ .gitignore adjusted: the gate contract (.karajan/review-gate, hooks) is now trackable — commit it");
    }
    const hookProbe = await runCommand("git", ["config", "core.hooksPath"]);
    if (!hookProbe.stdout?.trim()) {
      console.log("⚠ no core.hooksPath configured — run `kj harden` so the pre-commit hook enforces the gate");
    }
    return { installed: true };
  }

  const diff = await rawDiff(flags.range);

  const card = await enforceCardFirst({ config, projectDir });
  if (!card.ok) return { verdict: "rejected", reviewer: "card-first", issues: [{ severity: "high", description: card.reason }] };

  if (flags.check) {
    const res = await checkVerdict(projectDir, diff);
    console.log(res.ok
      ? `✓ verdict ok — approved by ${res.verdict.reviewer} (diff ${res.verdict.diffHash.slice(0, 12)})`
      : `✗ ${res.reason}`);
    process.exitCode = res.ok ? 0 : 1;
    return res;
  }

  // KJC-TSK-0676: deterministic pre-gate — sonar findings on the changed
  // files come back BEFORE any AI opinion. Blocking severities reject
  // without spending reviewer tokens; the rest travel with the task so
  // the cross-AI reviewer weighs them. Unavailable sonar degrades loudly.
  let task = flags.task;
  if (flags.sonar !== false) {
    const files = (await rawDiff(flags.range, ["--name-only"])).split("\n").map((f) => f.trim()).filter(Boolean);
    const pre = await runSonarPregate({ config, stagedFiles: files, logger });
    if (!pre.available) {
      console.log(`⚠ sonar pre-gate skipped: ${pre.reason}`);
    } else {
      const found = [...pre.blocking, ...pre.advisory];
      if (found.length > 0) {
        console.log(`Sonar on the changed files — ${pre.blocking.length} blocking, ${pre.advisory.length} advisory (project total: ${pre.totalProject}):`);
        for (const f of found) console.log(`  - ${formatSonarFinding(f)}`);
      }
      if (pre.blocking.length > 0) {
        console.log("✗ REJECTED by sonar (deterministic) — fix the blocking findings; the cross-AI reviewer was not invoked.");
        process.exitCode = 1;
        return {
          verdict: "rejected", reviewer: "sonar",
          issues: pre.blocking.map((i) => ({ severity: i.severity, file: undefined, description: formatSonarFinding(i) })),
        };
      }
      if (pre.advisory.length > 0) {
        task = `${task || "Review the following diff for correctness, security and maintainability."}\n\n`
          + `Deterministic Sonar findings on these files (fold them into your review):\n`
          + pre.advisory.map((f) => `- ${formatSonarFinding(f)}`).join("\n");
      }
    }
  }

  const record = await runOneShotReview({ diff, task, config, logger, projectDir });
  printVerdict(record);
  process.exitCode = record.verdict === "approved" ? 0 : 1;
  return record;
}
