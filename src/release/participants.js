/**
 * Release participants (ADR 0057, HU-4167): who is asked before a version goes out. The authors of
 * the commits since the last tag (what goes out) and the owners of the open PRs (work that stays out).
 */
import { execFileSync } from "node:child_process";

/** @typedef {{ sha: string, subject: string, login: string|null, name: string, parents: number }} ReleaseCommit */
/** @typedef {{ number: number, title: string, author: string, headRefName: string, isDraft: boolean }} ReleasePr */

const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gitDefault = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const isBot = (login) => login.endsWith("[bot]");

/** Group items into entries keyed by `keyOf`, in first-appearance order. */
function groupBy(items, keyOf, makeEntry, push) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, makeEntry(item));
    push(groups.get(key), item);
  }
  return [...groups.values()];
}

/**
 * @param {{ commits: ReleaseCommit[], prs: ReleasePr[] }} input
 * @returns {{ goingOut: { who: string, login: string|null, commits: { sha: string, subject: string }[] }[],
 *   stayingOut: { who: string, login: string, prs: { number: number, title: string, draft: boolean }[] }[],
 *   participants: string[] }}
 */
export function participantsOf({ commits, prs }) {
  const goingOut = groupBy(
    commits.filter((c) => c.parents <= 1),
    (c) => (c.login ? `@${c.login}` : `#${c.name}`),
    (c) => ({ who: c.login ?? c.name, login: c.login, commits: [] }),
    (entry, c) => entry.commits.push({ sha: c.sha, subject: c.subject }),
  );
  const stayingOut = groupBy(
    prs,
    (p) => p.author,
    (p) => ({ who: p.author, login: p.author, prs: [] }),
    (entry, p) => entry.prs.push({ number: p.number, title: p.title, draft: p.isDraft }),
  );
  const logins = [...goingOut, ...stayingOut].map((e) => e.login).filter((l) => l && !isBot(l));
  return { goingOut, stayingOut, participants: [...new Set(logins)].toSorted() };
}

function lastTag(git) {
  try {
    return git(["describe", "--tags", "--abbrev=0"]).trim();
  } catch (error) {
    throw new Error(`No tag to release from: the repo has no previous tag (${error.message.trim()})`, { cause: error });
  }
}

// Only the fields a proposal needs: the compare answer also carries every file's patch.
const COMMIT_FIELDS = ".commits[] | {sha, message: .commit.message, login: .author.login, name: .commit.author.name, parents: (.parents | length)}";
const PR_FIELDS = ".[] | {number, title, author: .user.login, headRefName: .head.ref, isDraft: .draft}";
// GitHub's own naming: an owner is letters, digits and hyphens; a repo also takes "_" and ".".
const OWNER_NAME = /^[A-Za-z0-9-]+\/[\w.-]+$/;

/** Every page of a GitHub list, one object per line, so no cap leaves anyone out (--slurp is missing from the gh distros ship). */
async function everyPage(gh, endpoint, fields) {
  const out = await gh(["api", "--paginate", endpoint, "--jq", fields]);
  return out.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** @returns {ReleaseCommit} */
const toCommit = ({ message, ...c }) => ({ ...c, subject: message.split("\n")[0] });

/**
 * Read what a release proposal needs from git and GitHub.
 * @param {{ repo: string, gh?: (args: string[]) => Promise<string>, git?: (args: string[]) => string }} opts
 * @returns {Promise<{ tag: string, head: string, commits: ReleaseCommit[], prs: ReleasePr[] }>}
 */
export async function readReleaseInputs({ repo, gh = ghDefault, git = gitDefault }) {
  if (!OWNER_NAME.test(repo)) throw new Error(`Not an owner/name repo: ${JSON.stringify(repo)}`);
  const tag = lastTag(git);
  const head = git(["rev-parse", "HEAD"]).trim();
  const commits = await everyPage(gh, `repos/${repo}/compare/${tag}...${head}?per_page=100`, COMMIT_FIELDS);
  const prs = await everyPage(gh, `repos/${repo}/pulls?state=open&per_page=100`, PR_FIELDS);
  return { tag, head, commits: commits.map(toCommit), prs };
}
