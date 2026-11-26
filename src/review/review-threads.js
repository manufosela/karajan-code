// HU-4930 (KJC-TSK-1808, #4891): unresolved, not outdated review threads by anyone but the PR's author.
import { runCommand } from "../utils/process.js";

const QUERY = "query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { isResolved isOutdated path line comments(first: 1) { nodes { author { login } } } } } } } }";
const JQ = ".data.repository.pullRequest.reviewThreads.nodes[] | {isResolved, isOutdated, path, line, author: .comments.nodes[0].author.login}";

/** A thread counts only when GitHub says, literally, that it is open and current, and someone else opened it. */
function isOpenThreadByOther(thread, author) {
  return thread?.isResolved === false && thread.isOutdated === false && thread.author !== author;
}

function threadProblem(thread) {
  const login = thread.author ?? "someone";
  const where = thread.line == null ? thread.path : `${thread.path}:${thread.line}`;
  return `${where} has an unresolved review thread by ${login}: resolve it on the PR`;
}

/**
 * @param {{ projectDir: string, pr: number|string, author?: string, run?: Function }} opts
 * @returns {Promise<string[]>} one problem per unresolved thread
 */
export async function unresolvedThreadProblems({ projectDir, pr, author, run = runCommand }) {
  const args = ["api", "graphql", "--paginate", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${pr}`, "-f", `query=${QUERY}`, "--jq", JQ];
  const res = await run("gh", args, { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`gh api graphql review threads failed: ${(res.stderr || res.stdout || "").trim()}`);
  return (res.stdout || "").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((thread) => isOpenThreadByOther(thread, author))
    .map(threadProblem);
}
