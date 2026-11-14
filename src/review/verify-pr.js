/**
 * KJC-TSK-1088: CI proof that every commit of a PR carries its cross-AI
 * verdict, so skipping the pre-commit hook (--no-verify) cannot leave a commit
 * unreviewed. It reads the review kj review --publish-pr posted for the PR's
 * head, written by a member of the repo, and recomputes the hash of the diff
 * each commit brought: a listed hash that no longer matches is no proof.
 */
import { runCommand } from "../utils/process.js";
import { diffHash } from "./verdict-store.js";
import { commitFiles, MARKER, SONAR_MARKS } from "./publish-pr.js";
import { trustedReviews } from "./trusted-review.js";
import { isCleanMerge } from "./clean-merge.js";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { isSealCommit } from "./seal-commit.js";
import { sourceFilesOf } from "./tests-with-code.js";

// The marker of a kj review for any head: what MARKER writes up to the head itself.
const MARKER_PREFIX = MARKER("\0").split("\0")[0];
// One line per commit, as publish-pr writes it: - `<sha7>` headline: approved by X (diff <hash12>)... · sonar <proof>
const LISTED = /^- `([0-9a-f]{7})` .*?\(diff ([0-9a-f]{12})\)(.*)$/gm;
// HU-4046: the marks that prove code was analysed, or that a human granted the Sonar rule.
const PROVED = [SONAR_MARKS.pass, SONAR_MARKS.granted];
const NO_SONAR = "its verdict carries no Sonar proof: run kj review --staged with Sonar up, then kj review --publish-pr";

/** The commits each kj review lists; a line with its Sonar proof wins over one without it. */
function listedCommits(kjReviews) {
  const listed = new Map();
  for (const m of kjReviews.flatMap((r) => [...r.body.matchAll(LISTED)])) {
    const entry = { hash: m[2], proved: PROVED.some((mark) => m[3].endsWith(mark)) };
    if (!listed.get(m[1])?.proved) listed.set(m[1], entry);
  }
  return listed;
}

/** Whether a commit touches code, by the extension rule and config the commit gate uses. */
async function touchesCode(projectDir, sha, run, config) {
  const { files, generated } = await commitFiles(projectDir, sha, run);
  return sourceFilesOf(config, files, generated).sources.length > 0;
}

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

/**
 * @returns {Promise<{ok: boolean, commits: number, problems: string[], sealCommits?: string[]}>}
 */
export async function verifyPrReview({ projectDir, pr, run = runCommand, sealed = null, config = {} }) {
  const info = await json(run, ["pr", "view", String(pr), "--json", "headRefOid,commits"], projectDir);
  const commits = info.commits ?? [];
  // One review per line, every page: --slurp is missing from the gh that distros ship.
  const res = await run("gh", ["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "--jq", ".[] | {body, author_association, user: {login: .user.login}}"], { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`gh api reviews failed: ${(res.stderr || res.stdout || "").trim()}`);
  const reviews = (res.stdout || "").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  // KJC-BUG-0391: any kj review a member published on the PR counts, not only the one for
  // today's head: the diff hash of each commit is what proves it, and a commit pushed after
  // the review is simply not listed. "Update branch" no longer leaves the check red.
  // HU-4270: a private org member reads as CONTRIBUTOR to the CI token; write access counts too.
  const judged = await trustedReviews(reviews.filter((r) => String(r.body ?? "").includes(MARKER_PREFIX)), { projectDir, run });
  const kjReviews = judged.trusted;
  const listed = listedCommits(kjReviews);
  const problems = [];
  const sealCommits = [];
  let seal = sealed;
  for (const c of commits) {
    if (await isCleanMerge(projectDir, c.oid, run)) continue;
    const entry = listed.get(c.oid.slice(0, 7));
    if (entry && (await hashesOf(projectDir, c.oid, run)).has(entry.hash)) {
      if (!entry.proved && (await touchesCode(projectDir, c.oid, run, config))) problems.push(`${c.oid.slice(0, 7)} (${c.messageHeadline}): ${NO_SONAR}`);
      continue;
    }
    seal ??= verifiedSupervisorFiles({ projectDir, trackedOnly: true });
    if (await isSealCommit(projectDir, c.oid, run, seal)) sealCommits.push(c.oid.slice(0, 7));
    else problems.push(`${c.oid.slice(0, 7)} (${c.messageHeadline}): no approved verdict for the diff it brings`);
  }
  // A PR that only brings the seal needs no review; anything else without one (a clean merge
  // included, KJC-BUG-0438) is told to publish it.
  const onlySeals = sealCommits.length > 0 && sealCommits.length === commits.length;
  if (kjReviews.length === 0 && !onlySeals) problems.splice(0, problems.length, `no kj review published by a member: run kj review --publish-pr ${pr}`, ...judged.rejected);
  return { ok: problems.length === 0, commits: commits.length, problems, ...(sealCommits.length > 0 ? { sealCommits } : {}) };
}
