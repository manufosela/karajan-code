/**
 * Detect GitHub repo and PR number from local git context.
 */

import { runCommand } from "../utils/process.js";

/**
 * Detect owner/repo from the git remote URL (origin).
 * Supports HTTPS, SSH, and custom SSH aliases (e.g. github.com-user).
 * Returns null if not a GitHub repo or not a git repo.
 */
export async function detectRepo() {
  const res = await runCommand("git", [
    "remote",
    "get-url",
    "origin"
  ]);
  if (res.exitCode !== 0) return null;

  const url = res.stdout.trim();
  // SSH: git@github.com:owner/repo.git  or  git@github.com-alias:owner/repo.git
  const sshMatch = /github\.com[^:]*:([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

/**
 * Detect the PR number for a given branch using gh CLI.
 * Returns null if no PR exists for the branch.
 */
export async function detectPrNumber(branch) {
  const args = ["pr", "view"];
  if (branch) args.push(branch);
  args.push("--json", "number", "--jq", ".number");
  const res = await runCommand("gh", args);
  if (res.exitCode !== 0) return null;

  const num = Number.parseInt(res.stdout.trim(), 10);
  return Number.isFinite(num) ? num : null;
}
