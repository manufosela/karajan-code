import { describe, it, expect } from "vitest";
import { createGithubMessageAdapter } from "../src/messages.js";
import { probeDiscussions } from "../src/discussions.js";
import { BoardRejectedError } from "../src/board-errors.js";

// A FAKE gh: no network, no token. The credentials differ only in what GitHub answers.
const ok = (data) => ({ exitCode: 0, stdout: JSON.stringify(data), stderr: "" });
const headed = (headers) => ({ exitCode: 0, stdout: `HTTP/2.0 200 OK\r\n${headers.join("\r\n")}\r\n\r\n{}`, stderr: "" });
const refused = (type, message) => ({ exitCode: 1, stdout: JSON.stringify({ data: { createDiscussion: null }, errors: [{ type, message }] }), stderr: `gh: ${message}` });
const FINE_GRAINED = headed(["Content-Type: application/json"]);
const CAN_WRITE = refused("UNPROCESSABLE", "Title can't be blank, Body can't be blank");
const DAY = Date.UTC(2026, 10, 11, 9, 0, 0);
const categories = (names, enabled = true) => ok({ data: { repository: { id: "R1", hasDiscussionsEnabled: enabled, discussionCategories: { nodes: names.map((n, i) => ({ id: `C${i}`, name: n })) } } } });
const ALL = categories(["Daily", "Refinement", "Retro"]);
const WRITER = { "-i rate_limit": FINE_GRAINED, discussionCategories: ALL, "title= ": CAN_WRITE };
const make = (answers) => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    if (!key) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return answers[key];
  };
  return { run, calls, adapter: () => createGithubMessageAdapter({ repo: "o/r", run, sleep: async () => {}, now: () => DAY }) };
};

describe("probeDiscussions: an empty createDiscussion, nothing is created", () => {
  it.each([
    ["UNPROCESSABLE (blank title and body) proves it can write", CAN_WRITE, true, /can write/],
    ["FORBIDDEN proves it cannot", refused("FORBIDDEN", "Resource not accessible by personal access token"), false, /cannot write.*Resource not accessible/],
    ["another GraphQL error proves nothing", refused("NOT_FOUND", "Could not resolve to a node"), false, /^not proven: NOT_FOUND/],
    ["a network failure proves nothing", { exitCode: 1, stdout: "", stderr: "dial tcp: i/o timeout" }, false, /^not proven: dial tcp/],
    ["an unexpected success proves nothing", ok({ data: {} }), false, /^not proven: /],
  ])("%s", async (_, answer, ceremonies, cause) => {
    const { run, calls } = make({ ...WRITER, "title= ": answer });
    expect(await probeDiscussions({ repo: "o/r", run })).toEqual({ ceremonies, cause: expect.stringMatching(cause) });
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["repositoryId=R1", "categoryId=C0", "title=", "body="]));
  });

  it.each([["public_repo, read:org"], ["repo"], [""]])("a classic token (scopes %j) is rejected before any GraphQL call", async (scopes) => {
    const { run, calls } = make({ "-i rate_limit": headed([`X-OAuth-Scopes: ${scopes}`]) });
    expect(await probeDiscussions({ repo: "o/r", run })).toEqual({ ceremonies: false, cause: expect.stringMatching(/classic token/) });
    expect(calls).toEqual([["api", "-i", "rate_limit"]]);
  });

  it("a repository without Discussions keeps them off", async () => {
    expect(await probeDiscussions({ repo: "o/r", run: make({ ...WRITER, discussionCategories: categories([], false) }).run })).toEqual({ ceremonies: false, cause: expect.stringMatching(/off/) });
  });

  it("a missing category fails loud naming it, before the write probe", async () => {
    const { run, calls } = make({ ...WRITER, discussionCategories: categories(["General"]) });
    await expect(probeDiscussions({ repo: "o/r", run })).rejects.toThrow(BoardRejectedError);
    await expect(probeDiscussions({ repo: "o/r", run })).rejects.toThrow(/"Daily" does not exist/);
    expect(calls.some((c) => c.includes("title="))).toBe(false);
  });
});

describe("ceremonies as Discussions", () => {
  it("a credential that can write declares the capability and opens the ceremony in its category", async () => {
    const { adapter, calls } = make({ "-X POST graphql": ok({ data: { createDiscussion: { discussion: { number: 7 } } } }), ...WRITER });
    const a = await adapter();
    expect(a.capabilities.ceremonies).toBe(true);
    expect(await a.openConversation("retro", "sprint 4")).toEqual({ kind: "discussion", number: 7 });
    expect(calls.at(-1).slice(0, 4)).toEqual(["api", "-X", "POST", "graphql"]);
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["repositoryId=R1", "categoryId=C2", "title=retro: 2026-11-11 sprint 4"]));
  });

  it("any other credential keeps the issues path, ceremonies false and the cause shown", async () => {
    const { adapter } = make({ "-i rate_limit": headed(["X-OAuth-Scopes: repo"]), "repos/o/r/labels/": ok({ name: "ceremony" }), "-X POST repos/o/r/issues": ok({ number: 42 }) });
    const a = await adapter();
    expect(a.capabilities.ceremonies).toBe(false);
    expect(a.ceremoniesCause).toMatch(/classic token/);
    expect(await a.openConversation("daily", "t")).toEqual({ kind: "issue", number: 42 });
  });

  it("lists the open Discussions of the kind's category across pages", async () => {
    const page = (nodes, hasNextPage, endCursor) => ok({ data: { repository: { discussions: { nodes, pageInfo: { hasNextPage, endCursor } } } } });
    const { adapter, calls } = make({ ...WRITER, "after=P1": page([{ number: 1, title: "daily: a" }], false, null), "discussions(": page([{ number: 2, title: "daily: b" }], true, "P1") });
    expect(await (await adapter()).listConversations("daily")).toEqual([{ kind: "discussion", number: 2, title: "daily: b" }, { kind: "discussion", number: 1, title: "daily: a" }]);
    expect(calls.filter((c) => c.join(" ").includes("discussions(") && c.join(" ").includes("categoryId=C0"))).toHaveLength(2);
  });
});

// HU-4138: the agent link talks in the ceremony's own thread, a Discussion.
describe("publish, listSince and close on a Discussion thread", () => {
  const D7 = { kind: "discussion", number: 7 };
  const thread = (closed, category = "Retro") => ok({ data: { repository: { discussion: { id: "D_7", closed, category: { name: category } } } } });
  const note = (id, at, edited = at, login = "ana") => ({ databaseId: id, body: `m${id}`, createdAt: at, updatedAt: edited, author: login ? { login } : null });
  const comments = (nodes, hasNextPage = false, endCursor = null) => ok({ data: { repository: { discussion: { comments: { nodes, pageInfo: { hasNextPage, endCursor } } } } } });
  const T1 = "2026-11-11T09:00:00Z";
  const T2 = "2026-11-11T10:00:00Z";

  it("publish adds a comment to the Discussion, the number passed as an integer", async () => {
    const posted = ok({ data: { addDiscussionComment: { comment: { databaseId: 91, createdAt: T1, author: { login: "bot" } } } } });
    const { adapter, calls } = make({ addDiscussionComment: posted, "closed category": thread(false), ...WRITER });
    expect(await (await adapter()).publish(D7, { body: "@hi" })).toEqual({ id: "91", author: "bot", serverTime: T1 });
    expect(calls.find((c) => c.join(" ").includes("closed category"))).toEqual(expect.arrayContaining(["-F", "number=7"]));
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["-X", "POST", "discussionId=D_7", "body=@hi"]));
  });

  it("publish refuses a bad body before any GraphQL call on the thread", async () => {
    const { adapter, calls } = make(WRITER);
    const a = await adapter();
    const before = calls.length;
    await expect(a.publish(D7, { body: "" })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(before);
  });

  it("a Discussion that does not exist fails loud", async () => {
    const { adapter } = make({ "closed category": ok({ data: { repository: { discussion: null } } }), ...WRITER });
    await expect((await adapter()).closeConversation(D7)).rejects.toThrow(/discussion #7 does not exist in o\/r/);
  });

  it("listSince reads every page, oldest first, then only what is new or edited", async () => {
    const { adapter } = make({ "after=P1": comments([note(2, T2, T2, null)]), "comments(first": comments([note(1, T1)], true, "P1"), ...WRITER });
    const a = await adapter();
    const first = await a.listSince(D7, null);
    expect(first.messages).toEqual([
      { id: "1", author: "ana", createdAt: T1, modifiedAt: T1, body: "m1" },
      { id: "2", author: "ghost", createdAt: T2, modifiedAt: T2, body: "m2" },
    ]);
    expect(await a.listSince(D7, first.cursor)).toEqual({ messages: [], cursor: first.cursor });
  });

  it("listSince sees an edit again", async () => {
    const answers = { ...WRITER, "comments(first": comments([note(1, T1)]) };
    const a = await make(answers).adapter();
    const { cursor } = await a.listSince(D7, null);
    answers["comments(first"] = comments([note(1, T1, T2)]);
    expect((await a.listSince(D7, cursor)).messages.map((m) => m.modifiedAt)).toEqual([T2]);
  });

  it("listSince refuses a cursor it did not issue", async () => {
    const { adapter } = make(WRITER);
    await expect((await adapter()).listSince(D7, "nope")).rejects.toThrow(/not issued by listSince/);
  });

  it.each([[false, "closed", 1], [true, "already_closed", 0]])("close (closed before: %s) gives %s", async (closed, result, writes) => {
    const { adapter, calls } = make({ closeDiscussion: ok({ data: { closeDiscussion: { discussion: { closed: true } } } }), "closed category": thread(closed), ...WRITER });
    expect(await (await adapter()).closeConversation(D7)).toEqual({ result });
    expect(calls.filter((c) => c.join(" ").includes("closeDiscussion"))).toHaveLength(writes);
  });

  it("close refuses a Discussion outside the ceremony categories", async () => {
    const { adapter, calls } = make({ "closed category": thread(false, "General"), ...WRITER });
    await expect((await adapter()).closeConversation(D7)).rejects.toThrow(/not a ceremony/);
    expect(calls.some((c) => c.join(" ").includes("closeDiscussion"))).toBe(false);
  });

  it("without Discussions a discussion thread is refused and issues keep working", async () => {
    const { adapter } = make({ "-i rate_limit": headed(["X-OAuth-Scopes: repo"]), "-X POST repos/o/r/issues/3/comments": ok({ id: 5, user: { login: "bot" }, created_at: T1 }) });
    const a = await adapter();
    await expect(a.publish(D7, { body: "x" })).rejects.toThrow(TypeError);
    expect(await a.publish({ kind: "issue", number: 3 }, { body: "x" })).toEqual({ id: "5", author: "bot", serverTime: T1 });
  });
});
