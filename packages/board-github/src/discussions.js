// HU-3802 (ADR 0043, slice 9): ceremonies as GitHub Discussions, one category per kind, GraphQL through `gh api graphql`.
// Only behind an explicit probe of the credential: a classic token (repo/public_repo) never qualifies.
import { BoardRejectedError } from "./board-errors.js";
import { gh } from "./github-board.js";
import { CEREMONY_CATEGORIES, CEREMONY_KINDS, checkKind, titleFor } from "./ceremonies.js";
import { checkBody, decodeCursor, pageSince } from "./comments.js";

const REPO = "repository(owner:$owner,name:$name)";
const VARS = "$owner:String!,$name:String!";
const CATEGORIES = `query(${VARS}){${REPO}{id hasDiscussionsEnabled discussionCategories(first:100){nodes{id name}}}}`;
const LIST = `query(${VARS},$categoryId:ID!,$after:String){${REPO}{discussions(first:100,after:$after,categoryId:$categoryId,states:[OPEN],orderBy:{field:CREATED_AT,direction:DESC}){nodes{number title} pageInfo{hasNextPage endCursor}}}}`;
const CREATE = "mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){discussion{number}}}";
const NUMBERED = `query(${VARS},$number:Int!`;
const THREAD = `${NUMBERED}){${REPO}{discussion(number:$number){id closed category{name}}}}`;
const COMMENTS = `${NUMBERED},$after:String){${REPO}{discussion(number:$number){comments(first:100,after:$after){nodes{databaseId body createdAt updatedAt author{login}} pageInfo{hasNextPage endCursor}}}}}`;
const COMMENT = "mutation($discussionId:ID!,$body:String!){addDiscussionComment(input:{discussionId:$discussionId,body:$body}){comment{databaseId createdAt author{login}}}}";
const CLOSE = "mutation($discussionId:ID!){closeDiscussion(input:{discussionId:$discussionId,reason:RESOLVED}){discussion{closed}}}";
// Every string goes as -f (raw): -F would read a file for a value that starts with "@". An integer goes as -F, typed.
const fields = (vars) => Object.entries(vars).flatMap(([k, v]) => [Number.isInteger(v) ? "-F" : "-f", `${k}=${v}`]);
const owned = (repo) => { const [owner, name] = repo.split("/"); return { owner, name }; };
const query = async (run, q, vars) => JSON.parse(await gh(run, ["api", "graphql", ...fields({ query: q, ...vars })])).data.repository;
const categoryIn = (repository, kind, repo) => {
  const wanted = CEREMONY_CATEGORIES[kind];
  const found = repository.discussionCategories.nodes.find((c) => c.name === wanted);
  if (!found) throw new BoardRejectedError(`the Discussions category ${JSON.stringify(wanted)} does not exist in ${repo}: an admin creates it in the repository settings`);
  return { repositoryId: repository.id, categoryId: found.id };
};
const firstError = (stdout) => { try { return JSON.parse(stdout).errors?.[0]; } catch { return undefined; } };

/**
 * Asks GitHub to create a Discussion with an EMPTY title and body: nothing is created. UNPROCESSABLE (blank fields)
 * means the credential passed authorization, so it can write; FORBIDDEN means it cannot; anything else proves
 * nothing and `ceremonies` stays false with the cause. A classic token (X-OAuth-Scopes is sent only for one) never qualifies.
 */
export async function probeDiscussions({ repo, run }) {
  const raw = await gh(run, ["api", "-i", "rate_limit"]);
  if (/^x-oauth-scopes:/im.test(raw.split(/\r?\n\r?\n/)[0])) return { ceremonies: false, cause: "a classic token never writes the ceremonies as Discussions" };
  const repository = await query(run, CATEGORIES, owned(repo));
  if (repository.hasDiscussionsEnabled !== true) return { ceremonies: false, cause: `Discussions are off in ${repo}` };
  const res = await run("gh", ["api", "graphql", ...fields({ query: CREATE, ...categoryIn(repository, CEREMONY_KINDS[0], repo), title: "", body: "" })]);
  const error = firstError(res.stdout);
  if (error?.type === "UNPROCESSABLE") return { ceremonies: true, cause: "the credential can write Discussions" };
  if (error?.type === "FORBIDDEN") return { ceremonies: false, cause: `the credential cannot write Discussions: ${error.message}` };
  return { ceremonies: false, cause: `not proven: ${error ? `${error.type} ${error.message}` : (res.stderr || res.stdout || `exit ${res.exitCode}`).trim()}` };
}

/** Every node of a paged connection; `pick` finds the connection in the repository. */
const allPages = async (run, q, vars, pick) => {
  const all = [];
  for (let after = null, more = true; more;) {
    const page = pick(await query(run, q, { ...vars, ...(after ? { after } : {}) }));
    all.push(...page.nodes);
    ({ hasNextPage: more, endCursor: after } = page.pageInfo);
  }
  return all;
};
/** The discussion number of a `{ kind: "discussion" }` thread, or null for any other kind (the issue path decides). */
const discussionNumber = (thread) => {
  if (thread?.kind !== "discussion") return null;
  if (!Number.isInteger(thread.number) || thread.number < 1) throw new TypeError(`thread ${JSON.stringify(thread)} must be { kind: discussion, number: positive integer }`);
  return thread.number;
};
// "ghost" is GitHub's own name for a deleted account. Top-level comments only: replies to a comment are not read.
const asMessage = (c) => ({ id: String(c.databaseId), author: c.author?.login ?? "ghost", createdAt: c.createdAt, modifiedAt: c.updatedAt, body: c.body });

/** HU-4138: publish, listSince and closeConversation on a Discussion; any other thread goes to `issues`. */
function discussionThreads({ repo, run, write, issues }) {
  const where = owned(repo);
  const discussion = async (number) => {
    const found = (await query(run, THREAD, { ...where, number })).discussion;
    if (!found) throw new BoardRejectedError(`discussion #${number} does not exist in ${repo}`);
    return found;
  };
  return {
    async publish(thread, message) {
      const number = discussionNumber(thread);
      if (number === null) return issues.publish(thread, message);
      checkBody(message);
      const { id } = await discussion(number);
      const c = (await write(["POST", "graphql", ...fields({ query: COMMENT, discussionId: id, body: message.body })])).data.addDiscussionComment.comment;
      return { id: String(c.databaseId), author: c.author?.login ?? "ghost", serverTime: c.createdAt };
    },
    // GraphQL has no `since` on comments: every page is read and the cursor filters, as on the issue path.
    async listSince(thread, cursor) {
      const number = discussionNumber(thread);
      if (number === null) return issues.listSince(thread, cursor);
      const seen = decodeCursor(cursor);
      const rows = await allPages(run, COMMENTS, { ...where, number }, (r) => r.discussion.comments);
      return pageSince(rows.map(asMessage), seen, cursor);
    },
    // Closes ONE open ceremony Discussion (one of the ceremony categories), checked with a read first; no retry.
    async closeConversation(thread) {
      const number = discussionNumber(thread);
      if (number === null) return issues.closeConversation(thread);
      const d = await discussion(number);
      if (!Object.values(CEREMONY_CATEGORIES).includes(d.category?.name)) throw new BoardRejectedError(`discussion #${number} is not a ceremony (category ${JSON.stringify(d.category?.name)}): it is not closed`);
      if (d.closed) return { result: "already_closed" };
      await write(["POST", "graphql", ...fields({ query: CLOSE, discussionId: d.id })]);
      return { result: "closed" };
    },
  };
}

/** The ceremonies over Discussions; `write` is the adapter's paced, never-retried writer. */
export function discussionCeremonies({ repo, run, write, now, issues }) {
  const where = owned(repo);
  const category = async (kind) => categoryIn(await query(run, CATEGORIES, where), kind, repo);
  return {
    ...discussionThreads({ repo, run, write, issues }),
    async openConversation(kind, title) {
      checkKind(kind);
      const full = titleFor(kind, title, now()); // validates before any gh call
      const ids = await category(kind);
      const out = await write(["POST", "graphql", ...fields({ query: CREATE, ...ids, title: full, body: full })]);
      return { kind: "discussion", number: out.data.createDiscussion.discussion.number };
    },
    async listConversations(kind) {
      checkKind(kind);
      const { categoryId } = await category(kind);
      const all = await allPages(run, LIST, { ...where, categoryId }, (r) => r.discussions);
      return all.map((d) => ({ kind: "discussion", number: d.number, title: d.title }));
    },
  };
}
