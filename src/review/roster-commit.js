// HU-4700 (issue #4661): a commit that only brings a roster change the roster verifies (the
// signatures are the proof, as in CI's roster-check) needs no AI verdict.
import { SIGNERS_FILE, verifyRosterChange } from "../harden/roster.js";

/** A file's parsed JSON at a revision, or null when the file is absent there. */
async function rosterAt(projectDir, rev, run) {
  const res = await run("git", ["-C", projectDir, "show", `${rev}:${SIGNERS_FILE}`]);
  return res.exitCode === 0 ? JSON.parse(String(res.stdout ?? "")) : null;
}

/** @returns {Promise<boolean>} true when the commit changes only the roster and the roster verifies the change. */
export async function isRosterCommit(projectDir, sha, run) {
  const res = await run("git", ["-C", projectDir, "diff", "--name-only", "--no-renames", `${sha}^`, sha]);
  if (res.exitCode !== 0) throw new Error(`git diff --name-only ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
  const files = (res.stdout || "").split("\n").map((f) => f.trim()).filter(Boolean);
  if (files.length !== 1 || files[0] !== SIGNERS_FILE) return false;
  try {
    const after = await rosterAt(projectDir, sha, run);
    return after !== null && verifyRosterChange({ before: await rosterAt(projectDir, `${sha}^`, run), after }).ok;
  } catch {
    return false;
  }
}
