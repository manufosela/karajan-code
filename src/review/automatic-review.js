/**
 * HU-4762 (operating contract, decision 1): a PR without a kj review may count the automatic AI
 * review its repo runs. Only the codex-state sticky comment of github-actions[bot] counts: it is
 * read by ./codex-state.js, which fails closed on anything unexpected, and judged here.
 * No network here: comments, files and the write-access check come in as arguments.
 */
import { isCodexStateComment, parseCodexState } from "./codex-state.js";

export const BOT = "github-actions[bot]";
const WORKFLOWS = ".github/workflows/";
const STATUSES = new Set(["active", "fixed", "dismissed"]);
const label = (f) => `${f.id} (${String(f.severity).toUpperCase()}, ${f.path}:${f.line})`;

/** Why a dismissed finding cannot count, or null when it can. Logins compare as GitHub's do: any case. */
async function dismissalProblem(f, { prAuthor, canWrite }) {
  if (String(f.severity).toUpperCase() !== "MINOR") return `finding ${label(f)} was dismissed, but only a MINOR finding may be: fix it`;
  const by = f.dismissal?.by;
  if (typeof by !== "string" || by === "") return `finding ${label(f)} was dismissed with no dismissal.by: dismiss it again as a maintainer`;
  if (by.toLowerCase() === prAuthor.toLowerCase()) return `finding ${label(f)} was dismissed by the PR author ${by}: another maintainer must dismiss it, or fix it`;
  if (!(await canWrite(by))) return `finding ${label(f)} was dismissed by ${by}, who has no write access: a maintainer must dismiss it, or fix it`;
  return null;
}

async function findingProblems(findings, deps) {
  const problems = [];
  for (const f of findings) {
    if (!STATUSES.has(f.status)) problems.push(`finding ${label(f)} has unknown status ${f.status}: the automatic review cannot count`);
    else if (f.status === "active") problems.push(`finding ${label(f)} is still active: fix it and let the bot review again`);
    else if (f.status === "dismissed") problems.push(await dismissalProblem(f, deps));
  }
  return problems.filter(Boolean);
}

/** The problems of the last bot codex-state comment against the PR head. */
async function reviewProblems(comments, { head, ...deps }) {
  const last = comments.findLast((c) => c?.user?.login === BOT && isCodexStateComment(c.body));
  if (!last) return [`no automatic review by ${BOT} on this PR: run kj review, or wait for the bot to review it`];
  let review;
  try {
    review = parseCodexState(last.body);
  } catch (err) {
    return [`${err.message}: the automatic review cannot count`];
  }
  const { recommendation, state } = review;
  const problems = [];
  if (state.reviewed.head !== head || state.observedHead !== head) {
    problems.push(`the automatic review is of ${state.reviewed.head} (observed ${state.observedHead}), not the PR head ${head}: wait for the bot to review the latest commit`);
  }
  if (recommendation !== "APPROVE") problems.push(`the automatic review recommends ${recommendation}, not APPROVE: address it and let the bot review again`);
  return [...problems, ...(await findingProblems(state.findings, deps))];
}

/**
 * Whether the repo's automatic AI review counts as the review of a PR at its head.
 * @param {{comments: {body: string, user: {login: string}}[], head: string, files: string[],
 *   prAuthor: string, canWrite: (login: string) => Promise<boolean>}} input
 * @returns {Promise<{ok: boolean, problems: string[]}>}
 */
export async function judgeAutomaticReview({ comments, head, files, prAuthor, canWrite }) {
  const valid = Array.isArray(comments) && Array.isArray(files) && typeof head === "string" && typeof prAuthor === "string" && prAuthor !== "" && typeof canWrite === "function";
  if (!valid) throw new TypeError("judgeAutomaticReview needs comments[], files[], a head sha, the PR author's login and a canWrite function");
  const problems = [];
  const workflows = files.filter((f) => f.startsWith(WORKFLOWS));
  if (workflows.length > 0) problems.push(`the PR changes ${workflows.join(", ")}: a workflow it brings could write the bot's comment, so the automatic review cannot count; get a kj review`);
  problems.push(...(await reviewProblems(comments, { head, prAuthor, canWrite })));
  return { ok: problems.length === 0, problems };
}
