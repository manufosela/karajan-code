// KJC-BUG-0388: kj harden --commit is the human's act, signed from the phone, and no AI
// reviews it. The proof is the signature, never the message: a commit that only touches
// files the roster-signed seal vouches for at the head is that act.
// KJC-BUG-0470: shared by verify-pr (the CI judge) and publish-pr, so both accept the same act.
import { PROVENANCE_FILE } from "../harden/supervisor-commit.js";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { isCleanMerge } from "./clean-merge.js";

// `base..head` or `base...head`; a base that starts with `-` would be read as an option.
const RANGE = /^([^.-].*?)\.{2,3}([^.].*)?$/;

/** The blob id of a file at a revision, or null when the file is absent there. */
async function blobAt(projectDir, rev, file, run) {
  const res = await run("git", ["-C", projectDir, "rev-parse", "--verify", "--quiet", `${rev}:${file}`]);
  return res.exitCode === 0 ? String(res.stdout || "").trim() : null;
}

/**
 * @param {{signed: boolean, complete?: boolean, files: Set<string>}} sealed what the signed seal vouches for
 * @returns {Promise<boolean>}
 */
export async function isSealCommit(projectDir, sha, run, sealed, head = "HEAD") {
  if (sealed.signed !== true) return false;
  const res = await run("git", ["-C", projectDir, "diff", "--name-only", `${sha}^`, sha]);
  if (res.exitCode !== 0) throw new Error(`git diff --name-only ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
  const files = (res.stdout || "").split("\n").filter(Boolean);
  // KJC-BUG-0438: the seal act writes the signed provenance; a commit without it only touched files.
  if (!files.includes(PROVENANCE_FILE)) return false;
  if (!files.every((f) => sealed.files.has(f) || (f === PROVENANCE_FILE && sealed.complete === true))) return false;
  // What the commit leaves is byte for byte what the signed seal vouches for at the head: a
  // precursor whose provenance or hooks a later commit replaced is not the seal act.
  for (const f of files) if ((await blobAt(projectDir, sha, f, run)) !== (await blobAt(projectDir, head, f, run))) return false;
  return true;
}

/**
 * KJC-BUG-0590: true only when the range brings at least one commit and every one, clean
 * merges aside (as verify-pr counts them), is the roster-signed seal act.
 * @returns {Promise<boolean>}
 */
export async function rangeIsOnlySeals({ projectDir, range, run }) {
  const m = RANGE.exec(String(range ?? ""));
  if (!m) return false;
  const head = m[2] || "HEAD";
  const res = await run("git", ["-C", projectDir, "rev-list", `${m[1]}..${head}`]);
  if (res.exitCode !== 0) throw new Error(`git rev-list ${range} failed: ${(res.stderr || "").trim()}`);
  let sealed = null;
  let seals = 0;
  for (const sha of (res.stdout || "").split("\n").filter(Boolean)) {
    if (await isCleanMerge(projectDir, sha, run)) continue;
    // Judged at the range's head, read from git, against the checkout's (the base's) roster.
    sealed ??= verifiedSupervisorFiles({ projectDir, trackedOnly: true, ref: head });
    if (!(await isSealCommit(projectDir, sha, run, sealed, head))) return false;
    seals += 1;
  }
  return seals > 0;
}
