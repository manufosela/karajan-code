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
