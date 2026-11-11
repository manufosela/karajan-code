import { describe, it, expect } from "vitest";
import { createGithubMessageReader, DEFAULT_POLL_SECONDS } from "../src/messages.js";
import { BoardOfflineError, BoardRejectedError } from "../src/board-errors.js";
import { assertMessageAdapter } from "../../story-contract/src/message-contract.js";

const comment = (id, login, createdAt, updatedAt, body) => ({ id, user: { login }, created_at: createdAt, updated_at: updatedAt, body });
const ok = (data) => ({ exitCode: 0, stdout: JSON.stringify(data), stderr: "" });
const fail = (stderr) => ({ exitCode: 1, stdout: "", stderr });
const thread = { kind: "issue", number: 7 };
// A fake gh: `answers` maps a substring of the endpoint to the canned result.
const reader = (answers) => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    if (!key) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return answers[key];
  };
  return { adapter: createGithubMessageReader({ repo: "o/r", run }), calls };
};
const c1 = comment(11, "alice", "2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z", "one");
const c2 = comment(12, "bob", "2026-11-01T11:00:00Z", "2026-11-01T11:00:00Z", "two");
const listed = async (answers, cursor = null) => { const r = reader(answers); return { ...r, ...(await r.adapter.listSince(thread, cursor)) }; };

describe("listSince", () => {
  it("returns id, author, times and body of the comments in order, with a cursor", async () => {
    const { messages, cursor, calls } = await listed({ "issues/7/comments": ok([c2, c1]) });
    expect(messages).toEqual([
      { id: "11", author: "alice", createdAt: c1.created_at, modifiedAt: c1.updated_at, body: "one" },
      { id: "12", author: "bob", createdAt: c2.created_at, modifiedAt: c2.updated_at, body: "two" },
    ]);
    expect(typeof cursor).toBe("string");
    expect(calls[0].slice(0, 3)).toEqual(["gh", "api", expect.stringContaining("repos/o/r/issues/7/comments")]);
  });

  it("follows the pages until a short one", async () => {
    const full = Array.from({ length: 100 }, (_, i) => comment(100 + i, "alice", c1.created_at, c1.updated_at, `m${i}`));
    const { messages } = await listed({ "&page=1": ok(full), "&page=2": ok([c2]) });
    expect(messages).toHaveLength(101);
  });

  it("asks only for what changed since the cursor, and says nothing new when so", async () => {
    const { cursor } = await listed({ "issues/7/comments": ok([c1, c2]) });
    const next = await listed({ "issues/7/comments": ok([c2]) }, cursor);
    expect(next.calls[0].join(" ")).toContain(`since=${c2.updated_at}`);
    expect({ messages: next.messages, cursor: next.cursor }).toEqual({ messages: [], cursor });
  });

  it("returns an edited comment again, with a changed modifiedAt", async () => {
    const { cursor } = await listed({ "issues/7/comments": ok([c1, c2]) });
    const edited = comment(11, "alice", c1.created_at, "2026-11-02T09:00:00Z", "one, edited");
    const next = await listed({ "issues/7/comments": ok([edited, c2]) }, cursor);
    expect(next.messages).toMatchObject([{ id: "11", body: "one, edited", modifiedAt: "2026-11-02T09:00:00Z" }]);
    expect(next.cursor).not.toBe(cursor);
  });

  it("gives an empty list and a null cursor for an empty thread", async () => {
    expect(await listed({ "issues/7/comments": ok([]) })).toMatchObject({ messages: [], cursor: null });
  });

  it.each([[{ kind: "issue", number: 0 }, null], [{ kind: "issue", number: "7" }, null], [{ kind: "wiki", number: 7 }, null], [null, null], [thread, "not-a-cursor"]])("rejects %j with cursor %j before any gh call", async (bad, cursor) => {
    const { adapter, calls } = reader({});
    await expect(adapter.listSince(bad, cursor)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("fails loud on a 5xx and on no network", async () => {
    await expect(listed({ comments: fail("gh: Server Error (HTTP 502)") })).rejects.toThrow(BoardRejectedError);
    await expect(listed({ comments: fail("error connecting to api.github.com") })).rejects.toThrow(BoardOfflineError);
  });
});

describe("authorPermission", () => {
  it.each([["admin", "admin"], ["write", "write"], ["read", "read"], ["none", "none"], ["maintain", "write"], ["triage", "read"]])("maps GitHub's %s to %s", async (given, want) => {
    const { adapter, calls } = reader({ "collaborators/carol/permission": ok({ permission: given }) });
    expect(await adapter.authorPermission("carol")).toBe(want);
    expect(calls[0].join(" ")).toContain("repos/o/r/collaborators/carol/permission");
  });

  it("is none for a 404, never an error", async () => {
    expect(await reader({ permission: fail("gh: Not Found (HTTP 404)") }).adapter.authorPermission("carol")).toBe("none");
  });

  it.each([[fail("gh: Forbidden (HTTP 403)"), BoardRejectedError], [fail("gh: Bad Gateway (HTTP 502)"), BoardRejectedError], [fail("dial tcp: no such host"), BoardOfflineError], [ok({ permission: "superuser" }), BoardRejectedError]])("fails loud on %j", async (answer, error) => {
    await expect(reader({ permission: answer }).adapter.authorPermission("carol")).rejects.toThrow(error);
  });

  it.each([["../../admin"], ["a b"], [""], ["-x"], [undefined], ["x".repeat(40)]])("rejects the user %j before any gh call", async (bad) => {
    const { adapter, calls } = reader({});
    await expect(adapter.authorPermission(bad)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe("limits", () => {
  it("gives the polling interval, the write pause and the quota left; fails loud without a quota", async () => {
    expect(await reader({ rate_limit: ok({ resources: { core: { remaining: 4321 } } }) }).adapter.limits()).toEqual({ minPollIntervalMs: DEFAULT_POLL_SECONDS * 1000, minWritePauseMs: 1000, quotaLeft: 4321 });
    await expect(reader({ rate_limit: ok({ resources: {} }) }).adapter.limits()).rejects.toThrow(BoardRejectedError);
  });
});

it("declares edit_history and the guarantees, and no write side: the full guard names exactly those", () => {
  const { adapter } = reader({});
  expect(adapter.capabilities).toEqual({ tasks: false, reviews: false, labels: false, ceremonies: false, notice: false, edit_history: true });
  expect(adapter.guarantees).toEqual({ stableMessageId: true, serverTime: true });
  expect(["publish", "setLabel", "openConversation"].map((op) => adapter[op])).toEqual([undefined, undefined, undefined]);
  expect(() => assertMessageAdapter(adapter)).toThrow(/missing publish, readAssignee, readReviewers, setLabel, readLabels, openConversation, listConversations/);
});
