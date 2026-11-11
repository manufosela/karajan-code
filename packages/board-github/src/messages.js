// HU-3797 (ADR 0043): the READ half of the message adapter over GitHub comments. Partial on purpose: nothing
// writes, so `assertMessageAdapter` (all ten operations) names the write side. gh holds the credential; the
// caller pins the account (`pinGhIdentity` lives in the core).
import { BoardRejectedError } from "./board-errors.js";
import { gh, runCommand } from "./github-board.js";

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

export function createGithubMessageReader({ repo, run = runCommand }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new TypeError(`repo ${JSON.stringify(repo)} must be owner/name`);
  const api = async (path) => JSON.parse(await gh(run, ["api", path]));
  return {
    // Edits show up as a newer updated_at (the `since` filter is on it), so a reader sees the message again.
    capabilities: { tasks: false, reviews: false, labels: false, ceremonies: false, notice: false, edit_history: true },
    guarantees: { stableMessageId: true, serverTime: true },
    async listSince(thread, cursor) {
      if (!["issue", "pull_request"].includes(thread?.kind) || !Number.isInteger(thread.number) || thread.number < 1) throw new TypeError(`thread ${JSON.stringify(thread)} must be { kind: issue|pull_request, number: positive integer }`);
      const seen = cursor === null ? null : decode(cursor);
      const found = [];
      for (let page = 1, got = PAGE; got === PAGE; page++) {
        const rows = await api(`repos/${repo}/issues/${thread.number}/comments?per_page=${PAGE}&page=${page}${seen ? `&since=${seen.since}` : ""}`);
        found.push(...rows);
        got = rows.length;
      }
      const fresh = found.filter((c) => !(seen && c.updated_at === seen.since && seen.ids.includes(String(c.id))));
      if (fresh.length === 0) return { messages: [], cursor };
      // "ghost" is GitHub's own name for a deleted account.
      const messages = fresh.map((c) => ({ id: String(c.id), author: c.user?.login ?? "ghost", createdAt: c.created_at, modifiedAt: c.updated_at, body: c.body })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      const since = messages.reduce((m, x) => (x.modifiedAt > m ? x.modifiedAt : m), seen?.since ?? "");
      const ids = [...(seen?.since === since ? seen.ids : []), ...messages.filter((m) => m.modifiedAt === since).map((m) => m.id)];
      return { messages, cursor: encode({ since, ids }) };
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
  };
}
