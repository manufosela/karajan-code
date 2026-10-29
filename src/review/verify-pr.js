/**
 * KJC-TSK-1088: CI proof that every commit of a PR carries its cross-AI
 * verdict, so skipping the pre-commit hook (--no-verify) cannot leave a commit
 * unreviewed. It reads the review kj review --publish-pr posted for the PR's
 * head, written by a member of the repo, and recomputes the hash of the diff
 * each commit brought: a listed hash that no longer matches is no proof.
 */
import { runCommand } from "../utils/process.js";
import { diffHash } from "./verdict-store.js";
import { MARKER } from "./publish-pr.js";
import { isCleanMerge } from "./clean-merge.js";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { PROVENANCE_FILE } from "../harden/supervisor-commit.js";

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// The marker of a kj review for any head: what MARKER writes up to the head itself.
const MARKER_PREFIX = MARKER("\0").split("\0")[0];
// One line per commit, as publish-pr writes it: - `<sha7>` headline: approved by X (diff <hash12>)...
const LISTED = /^- `([0-9a-f]{7})` .*?\(diff ([0-9a-f]{12})\)/gm;

async function json(run, args, cwd) {
  const res = await run("gh", args, { cwd });
  if (res.exitCode !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
  return JSON.parse(res.stdout || "null");
}

// KJC-BUG-0386: git abbreviates the object ids of the index lines by the clone's object
// count (or core.abbrev, 4 up to the full 40), so the publisher and CI may print the
// same diff with ids of other lengths.
const ABBREVS = Array.from({ length: 37 }, (_, i) => i + 4);

/** The diff hashes of a commit under every abbreviation git may have used where it was reviewed. */
async function hashesOf(projectDir, sha, run) {
  const hashes = new Set();
  for (const n of ABBREVS) {
    const res = await run("git", ["-C", projectDir, "diff", `--abbrev=${n}`, `${sha}^`, sha]);
    if (res.exitCode !== 0) throw new Error(`git diff ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
    hashes.add(diffHash(res.stdout).slice(0, 12));
  }
  return hashes;
}

// KJC-BUG-0388: kj harden --commit is the human's act, signed from the phone, and no AI
// reviews it. The proof is the signature, never the message: a commit that only touches
// files the roster-signed seal vouches for at the head is that act.
async function isSealCommit(projectDir, sha, run, sealed) {
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

/** The blob id of a file at a revision, or null when the file is absent there. */
async function blobAt(projectDir, rev, file, run) {
  const res = await run("git", ["-C", projectDir, "rev-parse", "--verify", "--quiet", `${rev}:${file}`]);
  return res.exitCode === 0 ? String(res.stdout || "").trim() : null;
}

/**
 * @returns {Promise<{ok: boolean, commits: number, problems: string[], sealCommits?: string[]}>}
 */
export async function verifyPrReview({ projectDir, pr, run = runCommand, sealed = null }) {
  const info = await json(run, ["pr", "view", String(pr), "--json", "headRefOid,commits"], projectDir);
  const commits = info.commits ?? [];
  // One review per line, every page: --slurp is missing from the gh that distros ship.
  const res = await run("gh", ["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "--jq", ".[] | {body, author_association}"], { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`gh api reviews failed: ${(res.stderr || res.stdout || "").trim()}`);
  const reviews = (res.stdout || "").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  // KJC-BUG-0391: any kj review a member published on the PR counts, not only the one for
  // today's head: the diff hash of each commit is what proves it, and a commit pushed after
  // the review is simply not listed. "Update branch" no longer leaves the check red.
  const kjReviews = reviews.filter((r) => TRUSTED.has(r.author_association) && String(r.body ?? "").includes(MARKER_PREFIX));
  const listed = new Map(kjReviews.flatMap((r) => [...r.body.matchAll(LISTED)].map((m) => [m[1], m[2]])));
  const problems = [];
  const sealCommits = [];
  let seal = sealed;
  for (const c of commits) {
    if (await isCleanMerge(projectDir, c.oid, run)) continue;
    const hash = listed.get(c.oid.slice(0, 7));
    if (hash && (await hashesOf(projectDir, c.oid, run)).has(hash)) continue;
    seal ??= verifiedSupervisorFiles({ projectDir, trackedOnly: true });
    if (await isSealCommit(projectDir, c.oid, run, seal)) sealCommits.push(c.oid.slice(0, 7));
    else problems.push(`${c.oid.slice(0, 7)} (${c.messageHeadline}): no approved verdict for the diff it brings`);
  }
  // A PR that only brings the seal needs no review; anything else without one (a clean merge
  // included, KJC-BUG-0438) is told to publish it.
  const onlySeals = sealCommits.length > 0 && sealCommits.length === commits.length;
  if (kjReviews.length === 0 && !onlySeals) problems.splice(0, problems.length, `no kj review published by a member: run kj review --publish-pr ${pr}`);
  return { ok: problems.length === 0, commits: commits.length, problems, ...(sealCommits.length > 0 ? { sealCommits } : {}) };
}
