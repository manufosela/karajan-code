// KJC-BUG-0388: kj harden --commit is the human's act, signed from the phone, and no AI
// reviews it. The proof is the signature, never the message: a commit that only touches
// files the roster-signed seal vouches for at the head is that act.
// KJC-BUG-0470: shared by verify-pr (the CI judge) and publish-pr, so both accept the same act.
import { PROVENANCE_FILE } from "../harden/supervisor-commit.js";

/** The blob id of a file at a revision, or null when the file is absent there. */
async function blobAt(projectDir, rev, file, run) {
  const res = await run("git", ["-C", projectDir, "rev-parse", "--verify", "--quiet", `${rev}:${file}`]);
  return res.exitCode === 0 ? String(res.stdout || "").trim() : null;
}

/**
 * @param {{signed: boolean, complete?: boolean, files: Set<string>}} sealed what the signed seal vouches for
 * @returns {Promise<boolean>}
 */
export async function isSealCommit(projectDir, sha, run, sealed) {
  if (sealed.signed !== true) return false;
  const res = await run("git", ["-C", projectDir, "diff", "--name-only", `${sha}^`, sha]);
  if (res.exitCode !== 0) throw new Error(`git diff --name-only ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
  const files = (res.stdout || "").split("\n").filter(Boolean);
  // KJC-BUG-0438: the seal act writes the signed provenance; a commit without it only touched files.
  if (!files.includes(PROVENANCE_FILE)) return false;
  if (!files.every((f) => sealed.files.has(f) || (f === PROVENANCE_FILE && sealed.complete === true))) return false;
  // What the commit leaves is byte for byte what the signed seal vouches for at the head: a
  // precursor whose provenance or hooks a later commit replaced is not the seal act.
  for (const f of files) if ((await blobAt(projectDir, sha, f, run)) !== (await blobAt(projectDir, "HEAD", f, run))) return false;
  return true;
}
