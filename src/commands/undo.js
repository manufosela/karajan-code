import { loadMostRecentSession } from "../session-store.js";
import { runCommand } from "../utils/process.js";

/**
 * Revert the last pipeline run by resetting to the pre-pipeline commit.
 * Default: soft reset (keeps changes staged). With --hard: discards all changes.
 */
export async function undoCommand({ hard = false, logger } = {}) {
  const session = await loadMostRecentSession();
  if (!session) {
    const msg = "No session to undo. No sessions found in the sessions directory.";
    if (logger) logger.error(msg);
    return { ok: false, error: msg };
  }

  const sha = session.session_start_sha;
  if (!sha) {
    const msg = `Session ${session.id} has no session_start_sha. Cannot determine the pre-pipeline commit.`;
    if (logger) logger.error(msg);
    return { ok: false, error: msg };
  }

  // Verify the SHA exists in git history
  const verifyRes = await runCommand("git", ["cat-file", "-t", sha]);
  if (verifyRes.exitCode !== 0 || verifyRes.stdout.trim() !== "commit") {
    const msg = `Commit ${sha} not found in git history. It may have been garbage-collected or belong to a different repository.`;
    if (logger) logger.error(msg);
    return { ok: false, error: msg };
  }

  // Check there are commits after the SHA (HEAD is ahead)
  const logRes = await runCommand("git", ["log", "--oneline", `${sha}..HEAD`]);
  if (logRes.exitCode !== 0 || !logRes.stdout.trim()) {
    const msg = `No commits to undo. HEAD is already at or before ${sha.slice(0, 8)}.`;
    if (logger) logger.warn(msg);
    return { ok: false, error: msg };
  }

  const mode = hard ? "--hard" : "--soft";
  const resetRes = await runCommand("git", ["reset", mode, sha]);
  if (resetRes.exitCode !== 0) {
    const msg = `git reset ${mode} ${sha} failed: ${resetRes.stderr || resetRes.stdout}`;
    if (logger) logger.error(msg);
    return { ok: false, error: msg };
  }

  const shortSha = sha.slice(0, 8);
  const message = hard
    ? `Reverted to pre-pipeline state (commit ${shortSha}). All changes discarded.`
    : `Reverted to pre-pipeline state (commit ${shortSha}). Changes are staged. Use \`git diff --cached\` to review.`;

  if (logger) logger.info(message);
  console.log(message);

  return {
    ok: true,
    message,
    sessionId: session.id,
    sha,
    mode: hard ? "hard" : "soft"
  };
}
