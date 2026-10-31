/**
 * KJC-TSK-0913: the cross-AI verdict kj holds for each commit of a PR, published
 * on the PR as ONE GitHub review (event COMMENT), so the review that already
 * happened counts in reviews.totalCount instead of looking like a blind merge.
 * A loose conversation comment does not count, so it is never used.
 */
import { runCommand } from "../utils/process.js";
import { diffHash, loadVerdict } from "./verdict-store.js";
import { isCleanMerge } from "./clean-merge.js";

export const MARKER = (head) => `<!-- kj-review head=${head} -->`;
/** Who may publish a kj review that counts: verify-pr ignores anyone else. */
export const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

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

/**
 * @returns {Promise<{published: boolean, commits?: number, reason?: string}>}
 */
export async function publishPrReview({ projectDir, pr, run = runCommand }) {
  const info = await json(run, "gh", ["pr", "view", String(pr), "--json", "headRefOid,commits"], projectDir);
  const rows = [];
  const uncovered = [];
  for (const c of info.commits ?? []) {
    // KJC-BUG-0391: a clean merge of the base brings no work of the PR and holds no verdict.
    if (await isCleanMerge(projectDir, c.oid, run)) continue;
    const v = await verdictOf(projectDir, c.oid, run);
    if (v?.verdict === "approved") rows.push({ ...c, v });
    else uncovered.push(`${c.oid.slice(0, 7)} (${c.messageHeadline})`);
  }
  if (uncovered.length > 0) throw new Error(`PR #${pr}: ${uncovered.length} commit(s) without an approved verdict of their exact diff, nothing published: ${uncovered.join(", ")}`);
  const reviews = await json(run, "gh", ["api", `repos/{owner}/{repo}/pulls/${pr}/reviews`], projectDir);
  // KJC-BUG-0456: one a non-member posted (gh switched to another account) does not count in CI.
  if ((reviews ?? []).some((r) => TRUSTED.has(r.author_association) && String(r.body ?? "").includes(MARKER(info.headRefOid)))) {
    return { published: false, reason: `a kj review for head ${info.headRefOid.slice(0, 7)} is already published` };
  }
  const body = [
    `Cross-AI review by Karajan, one verdict per commit, each bound to the exact diff it brought.`,
    "",
    ...rows.map((r) => {
      const summary = r.v.summary ? ". " + r.v.summary : "";
      return `- \`${r.oid.slice(0, 7)}\` ${r.messageHeadline}: approved by ${r.v.reviewer} (diff ${r.v.diffHash.slice(0, 12)})${summary}`;
    }),
    "",
    MARKER(info.headRefOid),
  ].join("\n");
  await json(run, "gh", ["api", "-X", "POST", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "-f", "event=COMMENT", "-f", `commit_id=${info.headRefOid}`, "-f", `body=${body}`], projectDir);
  return { published: true, commits: rows.length };
}
