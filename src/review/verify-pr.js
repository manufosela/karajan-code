/**
 * KJC-TSK-1088: CI proof that every commit of a PR carries its cross-AI
 * verdict, so skipping the pre-commit hook (--no-verify) cannot leave a commit
 * unreviewed. It reads the review kj review --publish-pr posted for the PR's
 * head, written by a member of the repo, and recomputes the hash of the diff
 * each commit brought: a listed hash that no longer matches is no proof.
 */
import { runCommand } from "../utils/process.js";
import { diffHash } from "./verdict-store.js";
import { commitFiles, MARKER, SONAR_MARKS, prBaseLayout } from "./publish-pr.js";
import { trustedReviews, canWriteRepo } from "./trusted-review.js";
import { setTimeout as delay } from "node:timers/promises";
import { judgeAutomaticReview, BOT } from "./automatic-review.js";
import { isCodexStateComment, parseCodexState } from "./codex-state.js";
import { isCleanMerge } from "./clean-merge.js";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { isSealCommit } from "./seal-commit.js";
import { isRosterCommit } from "./roster-commit.js";
import { sonarSourcesOf } from "./sonar-requirement.js";

// The marker of a kj review for any head: what MARKER writes up to the head itself.
const MARKER_PREFIX = MARKER("\0").split("\0")[0];
// One line per commit, as publish-pr writes it: - `<sha7>` headline: approved by X (diff <hash12>)... · sonar <proof>
const LISTED = /^- `([0-9a-f]{7})` .*?\(diff ([0-9a-f]{12})\)(.*)$/gm;
// HU-4046: the marks that prove code was analysed, or that a human granted the Sonar rule.
const PROVED = [SONAR_MARKS.pass, SONAR_MARKS.granted];
const NO_SONAR = "its verdict carries no Sonar proof: run kj review --staged with Sonar up, then kj review --publish-pr";
// HU-4774: the automatic AI reviews verify-pr can judge when a PR has no kj review.
const AUTOMATIC_REVIEWS = new Set(["codex-state"]);
// HU-4787: how often the PR comments are re-read while waiting for the bot.
const POLL_MS = 30_000;

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
export async function touchesCode(projectDir, sha, run, config, layout) {
  const { files, generated } = await commitFiles(projectDir, sha, run);
  return sonarSourcesOf({ config, files, generated, layout }).length > 0;
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
 * HU-4774: the judge's problems with the PR's automatic review. gh lists at most 100 files of a
 * PR, so a PR that changes more cannot prove it leaves the workflows alone: it never counts.
 */
async function automaticReviewProblems({ projectDir, pr, run, info, wait }) {
  const files = (info.files ?? []).map((f) => String(f.path));
  if (files.length !== info.changedFiles) return [`gh lists ${files.length} of its ${info.changedFiles} changed files, so the automatic review cannot count; get a kj review`];
  const read = async () => {
    const res = await run("gh", ["api", "--paginate", `repos/{owner}/{repo}/issues/${pr}/comments`, "--jq", ".[] | {body, user: {login: .user.login}}"], { cwd: projectDir });
    if (res.exitCode !== 0) throw new Error(`gh api comments failed: ${(res.stderr || res.stdout || "").trim()}`);
    return (res.stdout || "").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  };
  const { comments, timedOut } = await waitForBot({ read, head: info.headRefOid, ...wait });
  const canWrite = (login) => canWriteRepo(login, { projectDir, run });
  const judged = await judgeAutomaticReview({ comments, head: info.headRefOid, files, prAuthor: String(info.author?.login ?? ""), canWrite });
  const waited = timedOut ? [`waited ${wait.minutes} minute(s) and the bot has not reviewed the head ${info.headRefOid.slice(0, 7)}`] : [];
  return [...judged.problems, ...waited];
}

/** Whether the bot's last codex-state comment is settled: of the head, or unreadable (the judge fails it closed). */
function botSettled(comments, head) {
  const last = comments.findLast((c) => c?.user?.login === BOT && isCodexStateComment(c.body));
  if (!last) return false;
  try {
    const { state } = parseCodexState(last.body);
    return state.reviewed.head === head && state.observedHead === head;
  } catch {
    return true;
  }
}

/**
 * HU-4787: re-reads the comments every POLL_MS until the bot reviewed the head or the deadline
 * passes; the last sleep ends at the deadline, never past it.
 */
async function waitForBot({ read, head, minutes = null, sleep, now }) {
  const deadline = minutes === null ? 0 : now() + minutes * 60_000;
  for (;;) {
    const comments = await read();
    if (minutes === null || botSettled(comments, head)) return { comments, timedOut: false };
    const left = deadline - now();
    if (left <= 0) return { comments, timedOut: true };
    await sleep(Math.min(POLL_MS, left));
  }
}

/** The problems of a PR with no kj review by a member; the automatic review, when asked for, may cover it. */
async function noKjReviewProblems({ projectDir, pr, run, info, automaticReview, rejected, wait }) {
  const missing = `no kj review published by a member: run kj review --publish-pr ${pr}`;
  if (!automaticReview) return [missing, ...rejected];
  const automatic = await automaticReviewProblems({ projectDir, pr, run, info, wait });
  return automatic.length === 0 ? [] : [missing, ...automatic.map((p) => `automatic review: ${p}`), ...rejected];
}

/**
 * @param {{automaticReview?: "codex-state" | null}} options HU-4774: the automatic AI review that
 *   may cover a PR with no kj review by a member; null (the default) never reads it.
 * @param {{waitAutomatic?: number | null}} options HU-4787: minutes (integer 1..60) to wait for the bot
 *   to review the head, polling every 30 s; needs automaticReview. sleep(ms) and now() are injectable.
 * @returns {Promise<{ok: boolean, commits: number, problems: string[], sealCommits?: string[], automaticReview?: true}>}
 */
export async function verifyPrReview({ projectDir, pr, run = runCommand, sealed = null, config = {}, automaticReview = null, waitAutomatic = null, sleep = delay, now = Date.now }) {
  if (automaticReview !== null && !AUTOMATIC_REVIEWS.has(automaticReview)) {
    throw new Error(`unknown automatic review format ${automaticReview}: the known one is ${[...AUTOMATIC_REVIEWS].join(", ")}`);
  }
  if (waitAutomatic !== null && automaticReview === null) throw new Error("waitAutomatic needs an automatic review format (--automatic-review)");
  if (waitAutomatic !== null && !(Number.isInteger(waitAutomatic) && waitAutomatic >= 1 && waitAutomatic <= 60)) {
    throw new Error(`waitAutomatic ${waitAutomatic} is not an integer from 1 to 60 minutes`);
  }
  const wait = { minutes: waitAutomatic, sleep, now };
  const info = await json(run, ["pr", "view", String(pr), "--json", "headRefOid,commits,baseRefName,author,files,changedFiles"], projectDir);
  const commits = info.commits ?? [];
  const layout = await prBaseLayout(projectDir, info);
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
  const rosterCommits = [];
  let seal = sealed;
  for (const c of commits) {
    if (await isCleanMerge(projectDir, c.oid, run)) continue;
    const entry = listed.get(c.oid.slice(0, 7));
    if (entry && (await hashesOf(projectDir, c.oid, run)).has(entry.hash)) {
      if (!entry.proved && (await touchesCode(projectDir, c.oid, run, config, layout))) problems.push(`${c.oid.slice(0, 7)} (${c.messageHeadline}): ${NO_SONAR}`);
      continue;
    }
    seal ??= verifiedSupervisorFiles({ projectDir, trackedOnly: true });
    if (await isSealCommit(projectDir, c.oid, run, seal)) sealCommits.push(c.oid.slice(0, 7));
    else if (await isRosterCommit(projectDir, c.oid, run)) rosterCommits.push(c.oid.slice(0, 7));
    else problems.push(`${c.oid.slice(0, 7)} (${c.messageHeadline}): no approved verdict for the diff it brings`);
  }
  // A PR that only brings the seal needs no review; anything else without one (a clean merge
  // included, KJC-BUG-0438) is told to publish it.
  // HU-4700: roster commits the roster verifies count with the seals.
  const exempt = sealCommits.length + rosterCommits.length;
  const onlySeals = exempt > 0 && exempt === commits.length;
  // HU-4774: covered by the automatic review, no kj review exists, so no per-commit verdict applies.
  const missing = kjReviews.length === 0 && !onlySeals;
  if (missing) problems.splice(0, problems.length, ...(await noKjReviewProblems({ projectDir, pr, run, info, automaticReview, rejected: judged.rejected, wait })));
  const covered = missing && problems.length === 0;
  return { ok: problems.length === 0, commits: commits.length, problems, ...(covered ? { automaticReview: true } : {}), ...(sealCommits.length > 0 ? { sealCommits } : {}), ...(rosterCommits.length > 0 ? { rosterCommits } : {}) };
}
