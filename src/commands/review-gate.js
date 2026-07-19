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

// Raw git always — never a wrapped/compressing runner (KJC-BUG-0115).
async function rawDiff(range) {
  const args = range ? ["diff", range] : ["diff", "--cached"];
  const res = await runCommand("git", args);
  if (res.exitCode !== 0) {
    throw new Error(res.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return res.stdout;
}

function printVerdict(record) {
  if (record.verdict === "approved") {
    console.log(`✓ APPROVED by ${record.reviewer} (diff ${record.diffHash.slice(0, 12)})`);
    if (record.summary) console.log(`  ${record.summary}`);
    return;
  }
  console.log(`✗ REJECTED by ${record.reviewer} — ${record.issues.length} blocking issue(s):`);
  for (const issue of record.issues) {
    const where = issue.file ? ` [${issue.file}${issue.line ? `:${issue.line}` : ""}]` : "";
    console.log(`  - (${issue.severity || "high"})${where} ${issue.description || issue.id}`);
    if (issue.suggested_fix) console.log(`    fix: ${issue.suggested_fix}`);
  }
  console.log("Fix the issues and run `kj review --staged` again — the verdict is tied to the exact diff.");
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
    const hookProbe = await runCommand("git", ["config", "core.hooksPath"]);
    if (!hookProbe.stdout?.trim()) {
      console.log("⚠ no core.hooksPath configured — run `kj harden` so the pre-commit hook enforces the gate");
    }
    return { installed: true };
  }

  const diff = await rawDiff(flags.range);

  if (flags.check) {
    const res = await checkVerdict(projectDir, diff);
    console.log(res.ok
      ? `✓ verdict ok — approved by ${res.verdict.reviewer} (diff ${res.verdict.diffHash.slice(0, 12)})`
      : `✗ ${res.reason}`);
    process.exitCode = res.ok ? 0 : 1;
    return res;
  }

  const record = await runOneShotReview({ diff, task: flags.task, config, logger, projectDir });
  printVerdict(record);
  process.exitCode = record.verdict === "approved" ? 0 : 1;
  return record;
}
