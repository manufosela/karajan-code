/**
 * KJC-TSK-0913: the cross-AI verdict kj holds for each commit of a PR, published
 * on the PR as ONE GitHub review (event COMMENT), so the review that already
 * happened counts in reviews.totalCount instead of looking like a blind merge.
 * A loose conversation comment does not count, so it is never used.
 */
import { runCommand } from "../utils/process.js";
import { diffHash, loadVerdict } from "./verdict-store.js";
import { isCleanMerge } from "./clean-merge.js";
import { labelKarajanPr } from "../git/karajan-label.js";
import { isSealCommit } from "./seal-commit.js";
import { verifiedSupervisorFiles } from "../policy/supervisor-verify.js";
import { LIVE_FILTER, verdictSonarProof } from "./sonar-requirement.js";
import { linguistGenerated } from "./linguist-generated.js";
import { loadStandingExceptions } from "../policy/exceptions.js";
import { trustedReviews } from "./trusted-review.js";

export const MARKER = (head) => `<!-- kj-review head=${head} -->`;

// gh runs in the project's own directory, so it reads and writes the same repo the verdicts belong to.
async function json(run, cmd, args, cwd) {
  const res = await run(cmd, args, { cwd });
  if (res.exitCode !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
  return JSON.parse(res.stdout || "null");
}

/** The verdict of a commit: the one recorded for the diff it brought, staged byte for byte. */
async function verdictOf(projectDir, sha, run) {
  const res = await run("git", ["-C", projectDir, "diff", `${sha}^`, sha]);
  return res.exitCode === 0 && res.stdout ? loadVerdict(projectDir, diffHash(res.stdout)) : null;
}

/** HU-4046: what the commit gate saw of a commit: the files alive after it (LIVE_FILTER), and which git marks generated. */
export async function commitFiles(projectDir, sha, run) {
  const res = await run("git", ["-C", projectDir, "diff", "--name-only", LIVE_FILTER, `${sha}^`, sha]);
  if (res.exitCode !== 0) throw new Error(`git diff --name-only ${sha.slice(0, 7)} failed: ${(res.stderr || "").trim()}`);
  const files = (res.stdout || "").split("\n").map((f) => f.trim()).filter(Boolean);
  return { files, generated: linguistGenerated(files, { cwd: projectDir }) };
}

/** The proof CI reads at the end of a commit's line, by the mode of the Sonar requirement. */
export const SONAR_MARKS = { pass: " · sonar ok", granted: " · sonar granted", "docs-only": " · sonar n/a" };

/** HU-4046: the commit gate's Sonar requirement for an approved commit, where --no-verify cannot skip it. */
async function sonarMarkOf({ projectDir, c, v, run, config, std }) {
  const proof = verdictSonarProof({ verdict: v, config, ...(await commitFiles(projectDir, c.oid, run)), standingExceptions: std.standing });
  return proof.ok ? { mark: SONAR_MARKS[proof.mode] } : { problem: `${c.oid.slice(0, 7)} (${c.messageHeadline}): ${proof.reason}` };
}

/**
 * @returns {Promise<{published: boolean, commits?: number, reason?: string}>}
 */
export async function publishPrReview({ projectDir, pr, run = runCommand, sealed = null, config = {} }) {
  const info = await json(run, "gh", ["pr", "view", String(pr), "--json", "headRefOid,commits"], projectDir);
  const rows = [];
  const seals = [];
  const uncovered = [];
  const unproved = [];
  const std = loadStandingExceptions(projectDir);
  let seal = sealed;
  for (const c of info.commits ?? []) {
    // KJC-BUG-0391: a clean merge of the base brings no work of the PR and holds no verdict.
    if (await isCleanMerge(projectDir, c.oid, run)) continue;
    const v = await verdictOf(projectDir, c.oid, run);
    if (v?.verdict === "approved") {
      const { mark, problem } = await sonarMarkOf({ projectDir, c, v, run, config, std });
      if (problem) unproved.push(problem);
      else rows.push({ ...c, v, mark });
      continue;
    }
    // KJC-BUG-0470: the owner's kj harden --commit is a signed act, as verify-pr already accepts.
    seal ??= verifiedSupervisorFiles({ projectDir, trackedOnly: true });
    if (await isSealCommit(projectDir, c.oid, run, seal)) seals.push(c);
    else uncovered.push(`${c.oid.slice(0, 7)} (${c.messageHeadline})`);
  }
  if (uncovered.length > 0) throw new Error(`PR #${pr}: ${uncovered.length} commit(s) without an approved verdict of their exact diff, nothing published: ${uncovered.join(", ")}`);
  if (unproved.length > 0) throw new Error(`PR #${pr}: ${unproved.length} commit(s) whose verdict carries no Sonar proof, nothing published: ${unproved.join("; ")}`);
  // KJC-BUG-0461 (#2315): with kj run retired, this is where Karajan meets every PR it governs, so
  // the PR gets the «Karajan» label here. Labelling never fails the publish: a failure is warned.
  await labelKarajanPr({ url: String(pr), cwd: projectDir, run });
  const reviews = await json(run, "gh", ["api", `repos/{owner}/{repo}/pulls/${pr}/reviews`], projectDir);
  // KJC-BUG-0456: one a non-member posted (gh switched to another account) does not count in CI.
  // KJC-BUG-0477 (#3127): nor does one that misses a commit the PR gained under the same head
  // (a stacked PR retargeted to main); verify-pr adds up every kj review, so publish another.
  // HU-4046: nor one published before the Sonar marks: its code commits fail verify-pr.
  const marked = (body, r) => body.split("\n").some((l) => l.startsWith(`- \`${r.oid.slice(0, 7)}\``) && l.endsWith(r.mark));
  const listsAll = (body) => rows.every((r) => marked(body, r)) && seals.every((c) => body.includes(`\`${c.oid.slice(0, 7)}\``));
  // HU-4270: the same judge of the author as verify-pr (trusted-review.js).
  const forHead = (reviews ?? []).filter((r) => String(r.body ?? "").includes(MARKER(info.headRefOid)) && listsAll(String(r.body)));
  if ((await trustedReviews(forHead, { projectDir, run })).trusted.length > 0) {
    return { published: false, reason: `a kj review for head ${info.headRefOid.slice(0, 7)} is already published` };
  }
  const body = [
    `Cross-AI review by Karajan, one verdict per commit, each bound to the exact diff it brought.`,
    "",
    ...rows.map((r) => {
      // One line per commit, so the Sonar mark CI reads stays at its end.
      const summary = r.v.summary ? ". " + r.v.summary.replaceAll(/\s+/g, " ").trim() : "";
      return `- \`${r.oid.slice(0, 7)}\` ${r.messageHeadline}: approved by ${r.v.reviewer} (diff ${r.v.diffHash.slice(0, 12)})${summary}${r.mark}`;
    }),
    ...seals.map((s) => `- \`${s.oid.slice(0, 7)}\` ${s.messageHeadline}: the owner's sealed act (kj harden --commit, signed), not an AI review`),
    "",
    MARKER(info.headRefOid),
  ].join("\n");
  await json(run, "gh", ["api", "-X", "POST", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "-f", "event=COMMENT", "-f", `commit_id=${info.headRefOid}`, "-f", `body=${body}`], projectDir);
  return { published: true, commits: rows.length };
}
