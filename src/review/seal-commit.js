// KJC-BUG-0388: kj harden --commit is the human's act, signed from the phone, and no AI
// reviews it. The proof is the signature, never the message: a commit that only touches
// files the roster-signed seal vouches for at the head is that act.
// KJC-BUG-0470: shared by verify-pr (the CI judge) and publish-pr, so both accept the same act.
import { HOST_SETTINGS, PROVENANCE_FILE } from "../harden/supervisor-commit.js";
import { pinOnlyUpgrade } from "../harden/critical-seal.js";
import { HARNESS_WIRING, withoutKjHooks } from "../harden/harness-hooks.js";
import { SENTINEL_WIRING } from "../harden/sentinel-hooks.js";

const HOOKS_PREFIX = ".karajan/hooks/";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { isCleanMerge } from "./clean-merge.js";

// `base..head` or `base...head`; a base that starts with `-` would be read as an option.
const RANGE = /^([^.-].*?)\.{2,3}([^.].*)?$/;

/** The blob id of a file at a revision, or null when the file is absent there. */
async function blobAt(projectDir, rev, file, run) {
  const res = await run("git", ["-C", projectDir, "rev-parse", "--verify", "--quiet", `${rev}:${file}`]);
  return res.exitCode === 0 ? String(res.stdout || "").trim() : null;
}

/** A file's text at a revision, or null when the file is absent there. */
async function textAt(projectDir, rev, file, run) {
  const res = await run("git", ["-C", projectDir, "show", `${rev}:${file}`]);
  return res.exitCode === 0 ? String(res.stdout ?? "") : null;
}

const KJ_WIRING = [...HARNESS_WIRING, ...SENTINEL_WIRING];
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/** The shared settings as kj harden leaves them: the parent's, with kj's own hook entries taken out. */
function settingsWithoutKj(parent) {
  let settings;
  try { settings = JSON.parse(parent); } catch { return null; }
  return withoutKjHooks(settings, KJ_WIRING) ? `${JSON.stringify(settings, null, 2)}\n` : null;
}

/**
 * HU-4654 (issue #4653): with no roster there is no signature, and an AI reviewer judging kj's own
 * output rejects it. A file is kj's output when kj recomputes it: a hook the seal's verification
 * re-rendered, a workflow whose only change is its kj pin, the shared settings minus kj's hooks.
 * Anything else, a deletion included, is not.
 */
async function isKjOutput({ projectDir, sha, file, run, sealed }) {
  // Unsigned, nothing recomputes a deletion: a file the commit removes (the provenance or a hook
  // the seal records as deleted included) always goes to the review.
  const now = await textAt(projectDir, sha, file, run);
  if (now === null) return false;
  if (file === PROVENANCE_FILE) return sealed.complete === true;
  if (file.startsWith(HOOKS_PREFIX)) return sealed.files.has(file);
  const was = await textAt(projectDir, `${sha}^`, file, run);
  if (was === null) return false;
  if (WORKFLOW.test(file)) return pinOnlyUpgrade(was, now);
  // The runner drops the output's final newline, so that one newline is not compared.
  if (file === HOST_SETTINGS) return settingsWithoutKj(was)?.replace(/\n$/, "") === now.replace(/\n$/, "");
  return false;
}

/** Signed: what the roster's seal vouches for. No roster: only kj's own output (HU-4654). */
async function sealVouches({ projectDir, sha, files, run, sealed }) {
  if (sealed.signed === true) return files.every((f) => sealed.files.has(f) || (f === PROVENANCE_FILE && sealed.complete === true));
  if (sealed.signed !== false) return false;
  for (const file of files) if (!(await isKjOutput({ projectDir, sha, file, run, sealed }))) return false;
  return true;
}

/**
 * @param {{signed: boolean, complete?: boolean, files: Set<string>}} sealed what the seal vouches for;
 *   `signed` false means the repo has no roster
 * @returns {Promise<boolean>}
 */
export async function isSealCommit(projectDir, sha, run, sealed, head = "HEAD") {
  const res = await run("git", ["-C", projectDir, "diff", "--name-only", `${sha}^`, sha]);
  if (res.exitCode !== 0) throw new Error(`git diff --name-only ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
  const files = (res.stdout || "").split("\n").filter(Boolean);
  // KJC-BUG-0438: the seal act writes the signed provenance; a commit without it only touched files.
  if (!files.includes(PROVENANCE_FILE)) return false;
  if (!(await sealVouches({ projectDir, sha, files, run, sealed }))) return false;
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
