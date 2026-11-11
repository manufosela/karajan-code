import { describe, it, expect } from "vitest";
import { createGithubMessageReader } from "../src/messages.js";
import { CEREMONY_LABEL, titleFor } from "../src/ceremonies.js";
import { BoardRejectedError } from "../src/board-errors.js";
import { assertMessageAdapter } from "../../story-contract/src/message-contract.js";

const ok = (data) => ({ exitCode: 0, stdout: JSON.stringify(data), stderr: "" });
const fail = (stderr) => ({ exitCode: 1, stdout: "", stderr });
const DAY = Date.UTC(2026, 10, 11, 23, 59, 0); // 2026-11-11 in UTC (it is already the 12th in Madrid)
const make = (answers) => {
  const calls = [];
  const run = async (cmd, args) => {
    const line = args.join(" ");
    calls.push(args);
    const key = Object.keys(answers).find((k) => line.includes(k));
    if (!key) throw new Error(`unexpected gh call: ${line}`);
    return answers[key];
  };
  return { adapter: createGithubMessageReader({ repo: "o/r", run, sleep: async () => {}, now: () => DAY }), calls };
};
const labelsOk = { [`labels/${CEREMONY_LABEL}`]: ok({ name: CEREMONY_LABEL }), "labels/ceremony%3Adaily": ok({ name: "ceremony:daily" }) };
const created = ok({ number: 42 });

describe("openConversation", () => {
  it("opens one issue with the rule title and both labels, the title as a field, and returns the thread", async () => {
    const { adapter, calls } = make({ ...labelsOk, "-X POST": created });
    const title = "standup; $(rm -rf /) `x`";
    expect(await adapter.openConversation("daily", title)).toEqual({ kind: "issue", number: 42 });
    const posts = calls.filter((a) => a.includes("POST"));
    expect(posts).toEqual([["api", "-X", "POST", "repos/o/r/issues", "-f", `title=daily: 2026-11-11 ${title}`, "-f", "labels[]=ceremony", "-f", "labels[]=ceremony:daily"]]);
    expect(titleFor("retro", "x", DAY)).toBe("retro: 2026-11-11 x");
  });

  it("skips the kind label when it does not exist", async () => {
    const { adapter, calls } = make({ "labels/ceremony%3Aretro": fail("gh: Not Found (HTTP 404)"), [`labels/${CEREMONY_LABEL}`]: ok({}), "-X POST": created });
    await adapter.openConversation("retro", "t");
    expect(calls.at(-1)).not.toContain("labels[]=ceremony:retro");
    expect(calls.at(-1)).toContain("labels[]=ceremony");
  });

  it("fails loud naming a missing ceremony label, with no issue created", async () => {
    const { adapter, calls } = make({ [`labels/${CEREMONY_LABEL}`]: fail("gh: Not Found (HTTP 404)") });
    await expect(adapter.openConversation("daily", "t")).rejects.toThrow(new RegExp(`"${CEREMONY_LABEL}"`));
    expect(calls.some((a) => a.includes("POST"))).toBe(false);
  });

  it("does not hide another failure of the kind label lookup", async () => {
    const { adapter } = make({ "labels/ceremony%3Adaily": fail("gh: Forbidden (HTTP 403)"), [`labels/${CEREMONY_LABEL}`]: ok({}) });
    await expect(adapter.openConversation("daily", "t")).rejects.toThrow(BoardRejectedError);
  });

  it.each([["weekly", "t"], [undefined, "t"], ["daily", ""], ["daily", "a\nb"], ["daily", "a\u0007b"], ["daily", "x".repeat(250)], ["daily", 5]])("rejects %j %j before any gh call", async (kind, title) => {
    const { adapter, calls } = make({});
    await expect(adapter.openConversation(kind, title)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("never retries a failed creation", async () => {
    const { adapter, calls } = make({ ...labelsOk, "-X POST": fail("gh: Server Error (HTTP 502)") });
    await expect(adapter.openConversation("daily", "t")).rejects.toThrow(BoardRejectedError);
    expect(calls.filter((a) => a.includes("POST"))).toHaveLength(1);
  });
});

describe("listConversations", () => {
  const issue = (number, title, created, extra = {}) => ({ number, title, created_at: created, ...extra });
  const rows = [
    issue(1, "daily: 2026-11-09 a", "2026-11-09T08:00:00Z"),
    issue(3, "daily: 2026-11-11 c", "2026-11-11T08:00:00Z"),
    issue(2, "retro: 2026-11-10 b", "2026-11-10T08:00:00Z"),
    issue(4, "daily: 2026-11-10 pr", "2026-11-10T09:00:00Z", { pull_request: {} }),
    issue(5, "weekly daily: x", "2026-11-10T10:00:00Z"),
  ];

  it("lists only open ceremony issues of the kind, newest first, as threads with title", async () => {
    const { adapter, calls } = make({ "repos/o/r/issues?": ok(rows) });
    expect(await adapter.listConversations("daily")).toEqual([
      { kind: "issue", number: 3, title: "daily: 2026-11-11 c" },
      { kind: "issue", number: 1, title: "daily: 2026-11-09 a" },
    ]);
    expect(calls[0][1]).toMatch(/state=open&labels=ceremony&/);
  });

  it("follows the pages", async () => {
    const full = Array.from({ length: 100 }, (_, i) => issue(100 + i, `daily: 2026-01-01 n${i}`, "2026-01-01T00:00:00Z"));
    const { adapter } = make({ "&page=1": ok(full), "&page=2": ok([rows[1]]) });
    expect(await adapter.listConversations("daily")).toHaveLength(101);
  });

  it("rejects an unknown kind before any gh call", async () => {
    const { adapter, calls } = make({});
    await expect(adapter.listConversations("weekly")).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe("closeConversation", () => {
  const thread = { kind: "issue", number: 42 };
  const view = (extra = {}) => ok({ number: 42, state: "open", labels: [{ name: CEREMONY_LABEL }, { name: "ceremony:daily" }], ...extra });
  const patches = (calls) => calls.filter((a) => a.includes("PATCH"));

  it("closes one open ceremony issue with a single paced PATCH, state as a field", async () => {
    const { adapter, calls } = make({ "-X PATCH": ok({ number: 42, state: "closed" }), "repos/o/r/issues/42": view() });
    expect(await adapter.closeConversation(thread)).toEqual({ result: "closed" });
    expect(patches(calls)).toEqual([["api", "-X", "PATCH", "repos/o/r/issues/42", "-f", "state=closed"]]);
  });

  it("reports an already closed ceremony issue and changes nothing", async () => {
    const { adapter, calls } = make({ "repos/o/r/issues/42": view({ state: "closed" }) });
    expect(await adapter.closeConversation(thread)).toEqual({ result: "already_closed" });
    expect(patches(calls)).toHaveLength(0);
  });

  it.each([
    ["an issue without the ceremony label", { labels: [{ name: "bug" }] }],
    ["a pull request", { pull_request: {} }],
  ])("refuses %s before changing anything", async (_, extra) => {
    const { adapter, calls } = make({ "repos/o/r/issues/42": view(extra) });
    await expect(adapter.closeConversation(thread)).rejects.toThrow(BoardRejectedError);
    expect(patches(calls)).toHaveLength(0);
  });

  it.each([[{ kind: "pull_request", number: 42 }], [{ kind: "issue", number: "42; rm -rf /" }], [{ kind: "issue", number: 0 }], [undefined]])("refuses the thread %j before any gh call", async (bad) => {
    const { adapter, calls } = make({});
    await expect(adapter.closeConversation(bad)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("never retries a failed close", async () => {
    const { adapter, calls } = make({ "-X PATCH": fail("gh: Server Error (HTTP 502)"), "repos/o/r/issues/42": view() });
    await expect(adapter.closeConversation(thread)).rejects.toThrow(BoardRejectedError);
    expect(patches(calls)).toHaveLength(1);
  });
});

describe("the whole adapter", () => {
  it("has the ten operations, and ceremonies stays false: that capability is the native thread of Discussions", () => {
    const { adapter } = make({});
    expect(() => assertMessageAdapter(adapter)).not.toThrow();
    expect(adapter.capabilities.ceremonies).toBe(false);
  });
});
