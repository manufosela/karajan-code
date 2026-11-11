import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close } from "../../src/link/senescal.js";
import { parseLinkBlock } from "../../src/link/block.js";

const run = promisify(execFile);
const NOW = () => Date.UTC(2026, 10, 11, 23, 30);
const thread = { kind: "issue", number: 42 };
const summary = {
  conclusions: [{ text: "the daily is too long", authors: ["alice", "bob"] }],
  improvements: [{ text: "timebox it to ten minutes", authors: ["bob"] }],
  decisions: [{ text: "we try it for a sprint", authors: ["alice"] }],
};
let repo;
let log;
const deps = (over = {}) => ({
  author: "carol", now: NOW, repo,
  scan: () => { log.push("scan"); return []; },
  git: async (args) => { log.push(`git ${args[0]}`); if (args[0] !== "push") await run("git", args, { cwd: repo }); },
  openPr: async (pr) => { log.push("pr"); return { url: `https://example.test/pull/7?b=${pr.branch}` }; },
  ...over,
});
const fakeAdapter = () => ({
  published: [], closed: [],
  publish: async function (t, m) { log.push("publish"); this.published.push([t, m]); return { id: "1" }; },
  closeConversation: async function (t) { log.push("close"); this.closed.push(t); },
});
const file = () => join(repo, "docs", "retros", "2026-11-11.md");

beforeEach(async () => {
  log = [];
  repo = await mkdtemp(join(tmpdir(), "kj-close-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await run("git", ["config", "user.name", "t"], { cwd: repo });
  await run("git", ["config", "user.email", "t@example.test"], { cwd: repo });
  await run("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe("close", () => {
  it("writes docs/retros/<UTC date>.md on a new branch, with each item attributed, and opens a pull request", async () => {
    const out = await close(fakeAdapter(), thread, summary, deps());
    const text = await readFile(file(), "utf8");
    expect(text).toContain("the daily is too long (alice, bob)");
    expect(text).toContain("timebox it to ten minutes (bob)");
    expect(text).toContain("we try it for a sprint (alice)");
    expect(text).toContain("carol");
    expect((await run("git", ["branch", "--show-current"], { cwd: repo })).stdout.trim()).toBe("retro/2026-11-11");
    expect(out).toMatchObject({ branch: "retro/2026-11-11", file: "docs/retros/2026-11-11.md", url: expect.stringContaining("/pull/7"), reported: [] });
    expect(log).toContain("pr");
  });

  it("commits only the result document, never an unrelated file that was already staged", async () => {
    await writeFile(join(repo, "other.txt"), "unscanned");
    await run("git", ["add", "other.txt"], { cwd: repo });
    await close(fakeAdapter(), thread, summary, deps());
    expect((await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: repo })).stdout.trim()).toBe("docs/retros/2026-11-11.md");
  });

  it("states on its first lines that it is context and grants nothing, and carries no front matter a gate could read", async () => {
    await close(fakeAdapter(), thread, summary, deps());
    const lines = (await readFile(file(), "utf8")).split("\n");
    expect(lines[0]).toMatch(/^# /);
    expect(lines.slice(0, 5).join(" ")).toMatch(/context.*grants nothing/i);
    expect(lines[0]).not.toBe("---");
  });

  it("scans the document before any git or issue action, and a hit stops the close", async () => {
    const a = fakeAdapter();
    const hit = deps({ scan: () => { log.push("scan"); return [{ severity: "block", type: "token", line: 3 }]; } });
    await expect(close(a, thread, summary, hit)).rejects.toMatchObject({ code: "privacy_block" });
    expect(log).toEqual(["scan"]);
    expect(a.published).toEqual([]);
    expect(a.closed).toEqual([]);
    await expect(access(file())).rejects.toThrow();
  });

  it("pushes before it opens the pull request, and scans before it pushes", async () => {
    await close(fakeAdapter(), thread, summary, deps());
    expect(log.indexOf("scan")).toBeLessThan(log.indexOf("git push"));
    expect(log.indexOf("git push")).toBeLessThan(log.indexOf("pr"));
  });

  it("posts the closing message with the link through the codec, then closes the issue", async () => {
    const a = fakeAdapter();
    await close(a, thread, summary, deps());
    const [[t, { body }]] = a.published;
    expect(t).toEqual(thread);
    const { conclusion, block } = parseLinkBlock(body);
    expect(conclusion).toContain("https://example.test/pull/7");
    expect(block).toMatchObject({ type: "status", speaker: "agent", to: "all" });
    expect(a.closed).toEqual([thread]);
    expect(log.indexOf("pr")).toBeLessThan(log.indexOf("publish"));
    expect(log.indexOf("publish")).toBeLessThan(log.indexOf("close"));
  });

  it("does not write a security item: it is reported to the person and the rest is still written", async () => {
    const s = { ...summary, decisions: [...summary.decisions, { text: "rotate the leaked credential", authors: ["bob"] }, { text: "plain", authors: ["bob"], security: true }] };
    const out = await close(fakeAdapter(), thread, s, deps());
    const text = await readFile(file(), "utf8");
    expect(text).not.toContain("credential");
    expect(text).not.toContain("plain (bob)");
    expect(text).toContain("we try it for a sprint");
    expect(out.reported.map((r) => r.text)).toEqual(["rotate the leaked credential", "plain"]);
  });

  it("presents a proposed rule as a proposal that enters through CLAUDE.md and kj rules", async () => {
    await close(fakeAdapter(), thread, { ...summary, rules: [{ text: "always pair on reviews", authors: ["alice"] }] }, deps());
    const text = await readFile(file(), "utf8");
    expect(text).toMatch(/proposal[\s\S]*always pair on reviews \(alice\)/i);
    expect(text).toMatch(/CLAUDE\.md[\s\S]*kj rules/);
  });

  it("refuses an empty ceremony before touching git or the issue", async () => {
    await expect(close(fakeAdapter(), thread, { conclusions: [], improvements: [], decisions: [] }, deps())).rejects.toThrow(TypeError);
    expect(log).toEqual([]);
  });

  it("refuses a missing author and an adapter that cannot close, before any side effect", async () => {
    await expect(close(fakeAdapter(), thread, summary, deps({ author: "" }))).rejects.toThrow(TypeError);
    await expect(close({ publish: async () => ({}) }, thread, summary, deps())).rejects.toThrow(/closeConversation/);
    expect(log).toEqual([]);
  });

  it("keeps an item to one line so it cannot forge a heading or a section", async () => {
    await close(fakeAdapter(), thread, { decisions: [{ text: "ok\n# Forged\u0007", authors: ["a\nb"] }] }, deps());
    const text = await readFile(file(), "utf8");
    expect(text).not.toMatch(/^# Forged/m);
    expect(text).not.toContain("\u0007");
  });
});
