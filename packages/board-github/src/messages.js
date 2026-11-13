// HU-3797/HU-3798/HU-3800 (ADR 0043): the message adapter over GitHub comments, with ceremonies as issues
// (all ten operations of `assertMessageAdapter`). gh holds the credential; the
// caller pins the account (`pinGhIdentity` lives in the core).
import { BoardRejectedError } from "./board-errors.js";
import { gh, runCommand } from "./github-board.js";
import { CEREMONY_LABEL, checkKind, kindLabel, titleFor } from "./ceremonies.js";
import { discussionCeremonies, probeDiscussions } from "./discussions.js";

/** The owner's decision (D4 of the spec): the one place the polling interval lives. */
export const DEFAULT_POLL_SECONDS = 60;
const WRITE_PAUSE_MS = 1000; // ADR 0043 item 15
const PAGE = 100;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// GitHub says triage and maintain as well: triage only reads and triages (read), maintain manages without admin (write).
const LEVEL = { none: "none", read: "read", triage: "read", write: "write", maintain: "write", admin: "admin" };
const encode = (c) => Buffer.from(JSON.stringify(c)).toString("base64url");
const decode = (s) => {
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString());
    if (typeof c.since === "string" && Array.isArray(c.ids)) return c;
  } catch { /* falls through to the loud error */ }
  throw new TypeError("cursor was not issued by listSince");
};

const MAX_BODY = 60000;
const MAX_LABEL = 50;
const REVIEW_STATE = { APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", COMMENTED: "commented" }; // PENDING says nothing
const checkThread = (thread, kinds = ["issue", "pull_request"]) => {
  if (!kinds.includes(thread?.kind) || !Number.isInteger(thread.number) || thread.number < 1) throw new TypeError(`thread ${JSON.stringify(thread)} must be { kind: ${kinds.join("|")}, number: positive integer }`);
};
const checkLabel = (label) => {
  if (typeof label !== "string" || label.length < 1 || label.length > MAX_LABEL || [...label].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) throw new TypeError(`label ${JSON.stringify(label)} must be 1 to ${MAX_LABEL} characters, no control characters`);
};

const checkRepo = (repo) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new TypeError(`repo ${JSON.stringify(repo)} must be owner/name`);
};
/** HU-3802: probes the credential first; Discussions carry the ceremonies only when the probe says so. */
export const createGithubMessageAdapter = async (opts) => {
  checkRepo(opts.repo);
  const probe = await probeDiscussions({ repo: opts.repo, run: opts.run ?? runCommand });
  return { ...createGithubMessageReader({ ...opts, discussions: probe.ceremonies }), ceremoniesCause: probe.cause };
};
// The write side goes one call at a time, a pause apart, and never retries: a repeated POST can post twice.
// `sleep` and `now` are injectable so tests do not wait.
export function createGithubMessageReader({ repo, run = runCommand, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, discussions = false }) {
  checkRepo(repo);
  const api = async (path) => JSON.parse(await gh(run, ["api", path]));
  const paged = async (path, query = "") => {
    const all = [];
    for (let page = 1, got = PAGE; got === PAGE; page++) {
      const rows = await api(`${path}?per_page=${PAGE}&page=${page}${query}`);
      all.push(...rows);
      got = rows.length;
    }
    return all;
  };
  let queue = Promise.resolve();
  let lastWriteAt = null;
  const write = (args) => {
    const turn = queue.then(async () => {
      const wait = lastWriteAt === null ? 0 : lastWriteAt + WRITE_PAUSE_MS - now();
      if (wait > 0) await sleep(wait);
      try { return JSON.parse((await gh(run, ["api", "-X", ...args])) || "null"); } finally { lastWriteAt = now(); }
    });
    queue = turn.catch(() => {}); // a failed write frees the line for the next one; it is not retried
    return turn;
  };
  const readLabels = async (card) => {
    checkThread(card);
    return (await paged(`repos/${repo}/issues/${card.number}/labels`)).map((l) => l.name);
  };
  const labelExists = async (label) => {
    try { await api(`repos/${repo}/labels/${encodeURIComponent(label)}`); return true; } catch (err) {
      if (/HTTP 404/.test(err.message)) return false;
      throw err;
    }
  };
  const assertLabelExists = async (label) => {
    if (!(await labelExists(label))) throw new BoardRejectedError(`label ${JSON.stringify(label)} does not exist in ${repo}: this adapter does not create labels`);
  };
  return {
    // Edits show up as a newer updated_at (the `since` filter is on it), so a reader sees the message again.
    capabilities: { tasks: true, reviews: true, labels: true, ceremonies: discussions === true, notice: false, edit_history: true },
    guarantees: { stableMessageId: true, serverTime: true },
    async publish(thread, message) {
      checkThread(thread);
      if (typeof message?.body !== "string" || message.body.length < 1 || message.body.length > MAX_BODY) throw new TypeError(`message.body must be a string of 1 to ${MAX_BODY} characters`);
      const c = await write(["POST", `repos/${repo}/issues/${thread.number}/comments`, "-f", `body=${message.body}`]);
      return { id: String(c.id), author: c.user?.login ?? "ghost", serverTime: c.created_at };
    },
    readLabels,
    async setLabel(card, label, on) {
      checkThread(card);
      checkLabel(label);
      await assertLabelExists(label);
      if (on) await write(["POST", `repos/${repo}/issues/${card.number}/labels`, "-f", `labels[]=${label}`]);
      else if ((await readLabels(card)).includes(label)) await write(["DELETE", `repos/${repo}/issues/${card.number}/labels/${encodeURIComponent(label)}`]);
    },
    async readAssignee(card) {
      checkThread(card);
      return (await api(`repos/${repo}/issues/${card.number}`)).assignee?.login ?? null;
    },
    async readReviewers(change) {
      checkThread(change, ["pull_request"]);
      const base = `repos/${repo}/pulls/${change.number}`;
      const [pull, reviews] = await Promise.all([api(base), paged(`${base}/reviews`)]);
      const requested = pull.requested_reviewers ?? [];
      const latest = new Map();
      for (const r of reviews.sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))) {
        if (r.state === "DISMISSED") latest.delete(r.user?.login); // a dismissed review voids what came before it
        else if (r.user?.login && Object.hasOwn(REVIEW_STATE, r.state)) latest.set(r.user.login, REVIEW_STATE[r.state]);
      }
      const asked = requested.map((u) => u.login);
      return [...asked.map((user) => ({ user, state: "requested" })), ...[...latest].filter(([user]) => !asked.includes(user)).map(([user, state]) => ({ user, state }))];
    },
    async listSince(thread, cursor) {
      checkThread(thread);
      const seen = cursor === null ? null : decode(cursor);
      const found = await paged(`repos/${repo}/issues/${thread.number}/comments`, seen ? `&since=${seen.since}` : "");
      const fresh = found.filter((c) => !(seen && c.updated_at === seen.since && seen.ids.includes(String(c.id))));
      if (fresh.length === 0) return { messages: [], cursor };
      // "ghost" is GitHub's own name for a deleted account.
      const messages = fresh.map((c) => ({ id: String(c.id), author: c.user?.login ?? "ghost", createdAt: c.created_at, modifiedAt: c.updated_at, body: c.body })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      const since = messages.reduce((m, x) => (x.modifiedAt > m ? x.modifiedAt : m), seen?.since ?? "");
      const ids = [...(seen?.since === since ? seen.ids : []), ...messages.filter((m) => m.modifiedAt === since).map((m) => m.id)];
      return { messages, cursor: encode({ since, ids }) };
    },
    // HU-3800: a ceremony is a dedicated issue. `ceremonies` stays false: the contract means the native thread (Discussions, slice 9).
    async openConversation(kind, title) {
      checkKind(kind);
      const full = titleFor(kind, title, now()); // validates before any gh call
      const [, hasKindLabel] = await Promise.all([assertLabelExists(CEREMONY_LABEL), labelExists(kindLabel(kind))]);
      const labels = hasKindLabel ? [CEREMONY_LABEL, kindLabel(kind)] : [CEREMONY_LABEL];
      const issue = await write(["POST", `repos/${repo}/issues`, "-f", `title=${full}`, ...labels.flatMap((l) => ["-f", `labels[]=${l}`])]);
      return { kind: "issue", number: issue.number };
    },
    async listConversations(kind) {
      checkKind(kind);
      const open = await paged(`repos/${repo}/issues`, `&state=open&labels=${CEREMONY_LABEL}&sort=created&direction=desc`);
      return open.filter((i) => !i.pull_request && i.title.startsWith(`${kind}:`)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((i) => ({ kind: "issue", number: i.number, title: i.title }));
    },
    // HU-3897: closes ONE open ceremony issue. Returns `{ result: "closed" }`, or `{ result: "already_closed" }` when it was
    // closed before (reported, never hidden). The thread and the label are checked with a read before the one PATCH; no retry.
    // Rejected: the Senescal closing the issue with its own raw gh call, which would skip these checks and the write pacing.
    async closeConversation(thread) {
      checkThread(thread, ["issue"]);
      const issue = await api(`repos/${repo}/issues/${thread.number}`);
      if (issue.pull_request || !(issue.labels ?? []).some((l) => l.name === CEREMONY_LABEL)) throw new BoardRejectedError(`#${thread.number} is not a ceremony issue (no "${CEREMONY_LABEL}" label, or a pull request): it is not closed`);
      if (issue.state === "closed") return { result: "already_closed" };
      await write(["PATCH", `repos/${repo}/issues/${thread.number}`, "-f", "state=closed"]);
      return { result: "closed" };
    },
    async authorPermission(user) {
      if (typeof user !== "string" || !LOGIN.test(user)) throw new TypeError(`user ${JSON.stringify(user)} is not a GitHub login`);
      let level;
      try {
        level = (await api(`repos/${repo}/collaborators/${user}/permission`)).permission;
      } catch (err) {
        if (/HTTP 404/.test(err.message)) return "none"; // not a collaborator (or no such user): never an error
        throw err;
      }
      if (!Object.hasOwn(LEVEL, level)) throw new BoardRejectedError(`GitHub gave the unknown permission ${JSON.stringify(level)} for ${user}`);
      return LEVEL[level];
    },
    async limits() {
      const remaining = (await api("rate_limit")).resources?.core?.remaining;
      if (!Number.isInteger(remaining)) throw new BoardRejectedError("gh api rate_limit gave no core quota");
      return { minPollIntervalMs: DEFAULT_POLL_SECONDS * 1000, minWritePauseMs: WRITE_PAUSE_MS, quotaLeft: remaining };
    },
    ...(discussions === true ? discussionCeremonies({ repo, run, write, now }) : {}), // replaces the issue path above
  };
}
