/**
 * Read PR diff via gh CLI for Karajan CI flow.
 * The reviewer reads the PR diff instead of local git diff.
 */

import { runCommand } from "../utils/process.js";

/**
 * Get the diff of a PR via `gh pr diff <number>`.
 * Returns the diff string or throws on failure.
 */
export async function getPrDiff(prNumber) {
  if (!prNumber) throw new Error("prNumber is required");

  const res = await runCommand("gh", [
    "pr",
    "diff",
    String(prNumber)
  ]);

  if (res.exitCode !== 0) {
    throw new Error(`gh pr diff ${prNumber} failed: ${res.stderr || res.stdout}`);
  }

  return res.stdout;
}
