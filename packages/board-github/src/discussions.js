// HU-3802 (ADR 0043, slice 9): ceremonies as GitHub Discussions, one category per kind, GraphQL through `gh api graphql`.
// Only behind an explicit probe of the credential: a classic token (repo/public_repo) never qualifies.
import { BoardRejectedError } from "./board-errors.js";
import { gh } from "./github-board.js";
import { CEREMONY_CATEGORIES, CEREMONY_KINDS, checkKind, titleFor } from "./ceremonies.js";

const REPO = "repository(owner:$owner,name:$name)";
const VARS = "$owner:String!,$name:String!";
const CATEGORIES = `query(${VARS}){${REPO}{id hasDiscussionsEnabled discussionCategories(first:100){nodes{id name}}}}`;
const LIST = `query(${VARS},$categoryId:ID!,$after:String){${REPO}{discussions(first:100,after:$after,categoryId:$categoryId,states:[OPEN],orderBy:{field:CREATED_AT,direction:DESC}){nodes{number title} pageInfo{hasNextPage endCursor}}}}`;
const CREATE = "mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){discussion{number}}}";
// Every value goes as -f (a raw string): -F would read a file for a value that starts with "@".
const fields = (vars) => Object.entries(vars).flatMap(([k, v]) => ["-f", `${k}=${v}`]);
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

/** openConversation/listConversations over Discussions; `write` is the adapter's paced, never-retried writer. */
export function discussionCeremonies({ repo, run, write, now }) {
  const where = owned(repo);
  const category = async (kind) => categoryIn(await query(run, CATEGORIES, where), kind, repo);
  return {
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
      const all = [];
      for (let after = null, more = true; more;) {
        const page = (await query(run, LIST, { ...where, categoryId, ...(after ? { after } : {}) })).discussions;
        all.push(...page.nodes.map((d) => ({ kind: "discussion", number: d.number, title: d.title })));
        ({ hasNextPage: more, endCursor: after } = page.pageInfo);
      }
      return all;
    },
  };
}
