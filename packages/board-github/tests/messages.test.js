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

// A fake gh for the write side, with a fake clock whose sleep advances it. `answers` maps a substring of the call to the result (first match wins).
const writer = (answers) => {
  const calls = [];
  const sleeps = [];
  let t = 0;
  const run = async (cmd, args) => {
    const line = args.join(" ");
    calls.push({ args, at: t });
    const key = Object.keys(answers).find((k) => line.includes(k));
    if (!key) throw new Error(`unexpected gh call: ${line}`);
    return answers[key];
  };
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  return { adapter: createGithubMessageReader({ repo: "o/r", run, sleep, now: () => t }), calls, sleeps };
};
const posted = ok({ id: 501, user: { login: "kj-bot" }, created_at: "2026-11-03T08:00:00Z" });

describe("publish", () => {
  it("posts one comment with the body as one argument and returns its id, author and server time", async () => {
    const { adapter, calls } = writer({ "-X POST": posted });
    const text = "hi; $(rm -rf /) `x` \"q\"\nline two";
    expect(await adapter.publish(thread, { body: text })).toEqual({ id: "501", author: "kj-bot", serverTime: "2026-11-03T08:00:00Z" });
    expect(calls.map((c) => c.args)).toEqual([["api", "-X", "POST", "repos/o/r/issues/7/comments", "-f", `body=${text}`]]);
  });

  it("separates two writes by the pause, and a concurrent call waits its turn", async () => {
    const { adapter, calls, sleeps } = writer({ "-X POST": posted });
    await adapter.publish(thread, { body: "one" });
    expect(sleeps).toEqual([]); // the first write has nothing to wait for
    await Promise.all([adapter.publish(thread, { body: "two" }), adapter.publish(thread, { body: "three" })]);
    expect(calls.map((c) => c.at)).toEqual([0, 1000, 2000]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it.each([[fail("gh: Forbidden (HTTP 403)"), BoardRejectedError], [fail("gh: Unprocessable (HTTP 422)"), BoardRejectedError], [fail("dial tcp: no such host"), BoardOfflineError]])("throws on %j and never retries", async (answer, error) => {
    const { adapter, calls } = writer({ "-X POST": answer });
    await expect(adapter.publish(thread, { body: "x" })).rejects.toThrow(error);
    await expect(adapter.publish(thread, { body: "x" })).rejects.toThrow(error);
    expect(calls).toHaveLength(2); // one attempt per call, none repeated
  });

  it.each([[thread, { body: "" }], [thread, { body: "x".repeat(60001) }], [thread, { body: 5 }], [thread, null], [{ kind: "issue", number: 0 }, { body: "x" }], [{ kind: "wiki", number: 7 }, { body: "x" }]])("rejects %j %j before any gh call", async (bad, message) => {
    const { adapter, calls } = writer({});
    await expect(adapter.publish(bad, message)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("accepts a body of exactly 60,000 characters", async () => {
    await expect(writer({ "-X POST": posted }).adapter.publish(thread, { body: "x".repeat(60000) })).resolves.toMatchObject({ id: "501" });
  });
});

describe("labels", () => {
  const present = (names) => ({ "issues/7/labels?": ok(names.map((name) => ({ name }))), "labels/bug": ok({ name: "bug" }) });
  it("lists the names of the labels of a card", async () => {
    expect(await writer({ "issues/7/labels": ok([{ name: "bug" }, { name: "kj:hu" }]) }).adapter.readLabels(thread)).toEqual(["bug", "kj:hu"]);
  });

  it("follows the pages of labels", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
    const labels = await writer({ "&page=1": ok(full), "&page=2": ok([{ name: "bug" }]) }).adapter.readLabels(thread);
    expect(labels).toHaveLength(101);
    expect(labels.at(-1)).toBe("bug");
  });

  it("adds an existing label, and round-trips with readLabels", async () => {
    const { adapter, calls } = writer({ "-X POST": ok([]), "labels/bug": ok({ name: "bug" }) });
    await adapter.setLabel(thread, "bug", true);
    expect(calls.map((c) => c.args)).toEqual([["api", "repos/o/r/labels/bug"], ["api", "-X", "POST", "repos/o/r/issues/7/labels", "-f", "labels[]=bug"]]);
  });

  it("removes a label the card has, and does nothing when it is not there", async () => {
    const { adapter, calls } = writer({ "-X DELETE": ok([]), ...present(["bug"]) });
    await adapter.setLabel(thread, "bug", false);
    expect(calls.at(-1).args).toEqual(["api", "-X", "DELETE", "repos/o/r/issues/7/labels/bug"]);
    const none = writer(present([]));
    await none.adapter.setLabel(thread, "bug", false);
    expect(none.calls.some((c) => c.args.includes("DELETE"))).toBe(false);
  });

  it("fails loud naming a label that does not exist, and creates nothing", async () => {
    const { adapter, calls } = writer({ "labels/ghost": fail("gh: Not Found (HTTP 404)") });
    await expect(adapter.setLabel(thread, "ghost", true)).rejects.toThrow(/"ghost"/);
    expect(calls.some((c) => c.args.includes("POST"))).toBe(false);
  });

  it.each([[""], ["a\nb"], ["x".repeat(51)], [5], [undefined]])("rejects the label %j before any gh call", async (bad) => {
    const { adapter, calls } = writer({});
    await expect(adapter.setLabel(thread, bad, true)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

});

describe("readAssignee and readReviewers", () => {
  const pr = { kind: "pull_request", number: 9 };
  it("gives the assignee login, or null", async () => {
    expect(await writer({ "issues/7": ok({ assignee: { login: "alice" } }) }).adapter.readAssignee(thread)).toBe("alice");
    expect(await writer({ "issues/7": ok({ assignee: null }) }).adapter.readAssignee(thread)).toBeNull();
  });

  it("combines the requested reviewers and the reviews: the latest review of each wins", async () => {
    const review = (login, state, at) => ({ user: { login }, state, submitted_at: at });
    const { adapter } = writer({
      "pulls/9/reviews": ok([review("bob", "CHANGES_REQUESTED", "2026-11-01T10:00:00Z"), review("bob", "APPROVED", "2026-11-02T10:00:00Z"), review("dan", "COMMENTED", "2026-11-01T09:00:00Z"), review("eve", "PENDING", "2026-11-01T09:00:00Z")]),
      "pulls/9": ok({ requested_reviewers: [{ login: "carol" }] }),
    });
    expect(await adapter.readReviewers(pr)).toEqual([{ user: "carol", state: "requested" }, { user: "dan", state: "commented" }, { user: "bob", state: "approved" }]);
  });

  it("drops a reviewer whose later review was dismissed", async () => {
    const { adapter } = writer({
      "pulls/9/reviews": ok([{ user: { login: "bob" }, state: "APPROVED", submitted_at: "2026-11-01T00:00:00Z" }, { user: { login: "bob" }, state: "DISMISSED", submitted_at: "2026-11-02T00:00:00Z" }]),
      "pulls/9": ok({ requested_reviewers: [] }),
    });
    expect(await adapter.readReviewers(pr)).toEqual([]);
  });

  it("finds a review on the second page of reviews", async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ user: { login: `u${i}` }, state: "COMMENTED", submitted_at: "2026-11-01T00:00:00Z" }));
    const late = { user: { login: "u0" }, state: "CHANGES_REQUESTED", submitted_at: "2026-11-05T00:00:00Z" };
    const { adapter } = writer({ "&page=1": ok(filler), "&page=2": ok([late]), "pulls/9": ok({ requested_reviewers: [] }) });
    expect((await adapter.readReviewers(pr)).find((r) => r.user === "u0")).toEqual({ user: "u0", state: "changes_requested" });
  });

  it("rejects a change that is not a pull request before any gh call", async () => {
    const { adapter, calls } = writer({});
    await expect(adapter.readReviewers(thread)).rejects.toThrow(TypeError);
    await expect(adapter.readAssignee({ kind: "issue", number: -1 })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

it("declares what it implements, and the full guard passes", () => {
  const { adapter } = reader({});
  expect(adapter.capabilities).toEqual({ tasks: true, reviews: true, labels: true, ceremonies: false, notice: false, edit_history: true });
  expect(adapter.guarantees).toEqual({ stableMessageId: true, serverTime: true });
  expect(() => assertMessageAdapter(adapter)).not.toThrow();
});
