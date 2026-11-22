// HU-4787: with waitAutomatic, the no-kj-review path re-reads the PR comments every 30 s until the
// bot's codex-state comment is of the PR head or the deadline passes. Time is injected, never waited.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { MARKER } from "../../src/review/publish-pr.js";
import { diffHash } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-wait-")); execFileSync("git", ["init", "-q", dir]); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const HEAD = "b".repeat(40);
const OLD = "d".repeat(40);
const DIFF = "diff --git a/b.js b/b.js\n+const b = 2;\n";
const PR = { headRefOid: HEAD, commits: [{ oid: HEAD, messageHeadline: "fix: b" }], author: { login: "author" }, files: [{ path: "src/b.js" }], changedFiles: 1 };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const state = (head) => ({ status: "done", findings: [], reviewed: { head, base: "c".repeat(40) }, observedHead: head });
const botComment = (head) => ({ body: `<!-- codex-review-lifecycle:v1 -->\n**Recommendation: APPROVE**\n<!-- codex-state:${encode(state(head))} -->`, user: { login: "github-actions[bot]" } });

/** Each read of the comments returns the next page of `reads`; the last one repeats. onRead runs on each. */
function fakeRun({ reads = [[botComment(HEAD)]], reviews = [], calls = [], onRead = () => {} } = {}) {
  let read = 0;
  return async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(PR) };
    if (cmd === "git" && args.includes("--name-only")) return { exitCode: 0, stdout: "src/b.js" };
    if (cmd === "git" && args[2] === "rev-list") return { exitCode: 0, stdout: `${args.at(-1)} p0` };
    if (cmd === "git") return { exitCode: 0, stdout: DIFF };
    const isComments = String(args[2]).endsWith("/comments");
    if (isComments) onRead();
    const rows = isComments ? reads[Math.min(read++, reads.length - 1)] : reviews;
    if (cmd === "gh" && args.includes("--jq")) return { exitCode: 0, stdout: rows.map((r) => JSON.stringify(r)).join("\n") };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}
function clock() {
  const sleeps = [];
  let t = 0;
  return { sleeps, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, advance: (ms) => { t += ms; } };
}
const verify = (run, extra = {}) => verifyPrReview({ projectDir: dir, pr: 7, run, automaticReview: "codex-state", waitAutomatic: 5, ...extra });
const commentReads = (calls) => calls.filter((c) => c.includes("issues/7/comments")).length;

describe("verifyPrReview waitAutomatic", () => {
  it("waits two polls of 30 s when the bot comments the head on the third read", async () => {
    const c = clock();
    const calls = [];
    const r = await verify(fakeRun({ reads: [[], [botComment(OLD)], [botComment(HEAD)]], calls }), c);
    expect(r).toEqual({ ok: true, commits: 1, problems: [], automaticReview: true });
    expect(c.sleeps).toEqual([30000, 30000]);
    expect(commentReads(calls)).toBe(3);
  });

  it("fails with the waited message when the bot never reviews the head", async () => {
    const c = clock();
    const r = await verify(fakeRun({ reads: [[botComment(OLD)]] }), { ...c, waitAutomatic: 2 });
    expect(r.ok).toBe(false);
    expect(c.sleeps).toHaveLength(4);
    expect(r.problems).toContain(`automatic review: waited 2 minute(s) and the bot has not reviewed the head ${HEAD.slice(0, 7)}`);
  });

  it("never sleeps past the deadline when each read of the comments takes 10 s", async () => {
    const c = clock();
    const r = await verify(fakeRun({ reads: [[botComment(OLD)]], onRead: () => c.advance(10_000) }), { ...c, waitAutomatic: 1 });
    expect(r.ok).toBe(false);
    expect(c.sleeps).toEqual([30000, 10000]);
  });

  it("does not sleep when the bot already reviewed the head", async () => {
    const c = clock();
    const r = await verify(fakeRun(), c);
    expect(r.ok).toBe(true);
    expect(c.sleeps).toEqual([]);
  });

  it("stops the wait at once on a comment that does not parse", async () => {
    const c = clock();
    const bad = { body: "<!-- codex-review-lifecycle:v1 -->\nnothing else", user: { login: "github-actions[bot]" } };
    const r = await verify(fakeRun({ reads: [[bad]] }), c);
    expect(r.ok).toBe(false);
    expect(c.sleeps).toEqual([]);
    expect(r.problems.join("\n")).not.toContain("waited");
  });

  it("neither waits nor reads comments when a member published a kj review", async () => {
    const body = `- \`${HEAD.slice(0, 7)}\` fix: b: approved by codex (diff ${diffHash(DIFF).slice(0, 12)}) · sonar ok\n${MARKER(HEAD)}`;
    const c = clock();
    const calls = [];
    const r = await verify(fakeRun({ reviews: [{ body, author_association: "OWNER" }], calls }), c);
    expect(r.ok).toBe(true);
    expect(c.sleeps).toEqual([]);
    expect(commentReads(calls)).toBe(0);
  });

  it("throws before any gh call without automaticReview", async () => {
    const calls = [];
    await expect(verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ calls }), waitAutomatic: 5 })).rejects.toThrow(/waitAutomatic.*automatic review/);
    expect(calls).toEqual([]);
  });

  it.each([0, 61, 1.5, "5", Number.NaN])("throws before any gh call on the value %s", async (value) => {
    const calls = [];
    await expect(verify(fakeRun({ calls }), { waitAutomatic: value })).rejects.toThrow(/integer from 1 to 60/);
    expect(calls).toEqual([]);
  });
});
