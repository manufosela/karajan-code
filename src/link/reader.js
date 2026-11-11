/**
 * HU-3799 (5a): the reader of a thread. Keeps only the messages of authors who
 * may write, parses them as data, and flags a message edited after it was read.
 * Rejected: trusting the adapter (or GitHub's `author_association`) to filter;
 * the filter lives here so it works unchanged for any adapter and fails closed.
 */
import { createHash } from "node:crypto";
import { DEFAULT_PERMISSION_TTL_SECONDS } from "./constants.js";
import { LinkBlockError, parseLinkBlock } from "./block.js";

const LOOKUP_FAILED = Symbol("lookup-failed");
const MAY_WRITE =new Set(["write", "admin"]);
const answers = new WeakMap(); // adapter -> Map(author -> { permission, at }); in memory only
const sha256 = (body) => createHash("sha256").update(body).digest("hex");

/** The author's permission, or LOOKUP_FAILED when the lookup failed (never cached, never `write`). */
async function permissionOf(adapter, author, now, ttlMs) {
  const cache = answers.get(adapter) ?? answers.set(adapter, new Map()).get(adapter);
  const hit = cache.get(author);
  if (hit && now - hit.at < ttlMs) return hit.permission;
  try {
    const permission = await adapter.authorPermission(author);
    cache.set(author, { permission, at: now });
    return permission;
  } catch {
    return LOOKUP_FAILED;
  }
}

function parse(body) {
  try {
    const { conclusion, block } = parseLinkBlock(body);
    return { kind: "message", ...block, conclusion };
  } catch (error) {
    if (!(error instanceof LinkBlockError)) throw error;
    return error.code === "no_block" ? { kind: "note", text: body } : { kind: "note", text: body, parseError: error.code };
  }
}

/** Returns `{ messages, cursor, seen, dropped }`; the caller advances the record with `markRead`. */
export async function readInbox({ adapter, thread, store, now = Date.now, permissionTtlSeconds = DEFAULT_PERMISSION_TTL_SECONDS }) {
  const { messages: listed, cursor } = await adapter.listSince(thread, store.cursor);
  const dropped = { notPermitted: 0, permissionError: 0 };
  const messages = [];
  const seen = {};
  for (const { id, author, modifiedAt, body } of listed) {
    const permission = typeof author === "string" && author ? await permissionOf(adapter, author, now(), permissionTtlSeconds * 1000) : "none";
    if (permission === LOOKUP_FAILED) dropped.permissionError += 1;
    else if (!MAY_WRITE.has(permission)) dropped.notPermitted += 1;
    else {
      const hash = sha256(body);
      const before = Object.hasOwn(store.seen, id) ? store.seen[id] : null;
      if (before?.updatedAt === modifiedAt && before.hash === hash) continue;
      seen[id] = { updatedAt: modifiedAt, hash };
      messages.push({ ...parse(body), messageId: id, author, updatedAt: modifiedAt, ...(before ? { suspect: true, supersedes: id } : {}) });
    }
  }
  return { messages, cursor, seen, dropped };
}
