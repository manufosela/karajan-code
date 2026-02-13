import { runCommand } from "../utils/process.js";

export async function computeBaseRef({ baseBranch = "main", baseRef = null }) {
  if (baseRef) return baseRef;
  const mergeBase = await runCommand("git", ["merge-base", "HEAD", `origin/${baseBranch}`]);
  if (mergeBase.exitCode !== 0) {
    const fallback = await runCommand("git", ["rev-parse", "HEAD~1"]);
    if (fallback.exitCode !== 0) {
      throw new Error("Could not compute diff base reference");
    }
    return fallback.stdout.trim();
  }
  return mergeBase.stdout.trim();
}

export async function generateDiff({ baseRef }) {
  const result = await runCommand("git", ["diff", `${baseRef}..HEAD`]);
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
