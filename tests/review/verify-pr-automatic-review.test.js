// HU-4774: with --automatic-review codex-state, a PR with no kj review by a member may count the
// automatic AI review its repo runs, judged by judgeAutomaticReview against the PR's head.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { MARKER } from "../../src/review/publish-pr.js";
import { diffHash } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-auto-")); execFileSync("git", ["init", "-q", dir]); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const HEAD = "b".repeat(40);
const DIFF = "diff --git a/b.js b/b.js\n+const b = 2;\n";
const PR = { headRefOid: HEAD, commits: [{ oid: HEAD, messageHeadline: "fix: b" }], author: { login: "author" }, files: [{ path: "src/b.js" }], changedFiles: 1 };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const state = (head = HEAD) => ({ status: "done", findings: [], reviewed: { head, base: "c".repeat(40) }, observedHead: head });
const botComment = (head) => ({ body: `<!-- codex-review-lifecycle:v1 -->\n**Recommendation: APPROVE**\n<!-- codex-state:${encode(state(head))} -->`, user: { login: "github-actions[bot]" } });

function fakeRun({ reviews = [], comments = [botComment()], pr = PR, calls = [] } = {}) {
  return async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(pr) };
    if (cmd === "git" && args.includes("--name-only")) return { exitCode: 0, stdout: "src/b.js" };
    if (cmd === "git" && args[2] === "rev-list") return { exitCode: 0, stdout: `${args.at(-1)} p0` };
    if (cmd === "git") return { exitCode: 0, stdout: DIFF };
    const rows = String(args[2]).endsWith("/comments") ? comments : reviews;
    if (cmd === "gh" && args.includes("--jq")) return { exitCode: 0, stdout: rows.map((r) => JSON.stringify(r)).join("\n") };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}
const verify = (run, extra = {}) => verifyPrReview({ projectDir: dir, pr: 7, run, automaticReview: "codex-state", ...extra });
const readComments = (calls) => calls.some((c) => c.includes("issues/7/comments"));

describe("verifyPrReview --automatic-review codex-state", () => {
  it("passes on an approving bot review of the head when no kj review exists", async () => {
    expect(await verify(fakeRun())).toEqual({ ok: true, commits: 1, problems: [], automaticReview: true });
  });

  it("fails with the judge's problem when the bot reviewed an older head", async () => {
    const r = await verify(fakeRun({ comments: [botComment("d".repeat(40))] }));
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      "no kj review published by a member: run kj review --publish-pr 7",
      expect.stringMatching(/^automatic review: the automatic review is of d{40} .*not the PR head b{40}/),
    ]);
  });

  it("never counts when the PR lists fewer files than it changes", async () => {
    const r = await verify(fakeRun({ pr: { ...PR, changedFiles: 101 } }));
    expect(r.problems).toContainEqual(expect.stringMatching(/^automatic review: .*1 of its 101 changed files/));
  });

  it("ignores the comments when a member published a kj review", async () => {
    const body = `- \`${HEAD.slice(0, 7)}\` fix: b: approved by codex (diff ${diffHash(DIFF).slice(0, 12)}) · sonar ok\n${MARKER(HEAD)}`;
    const calls = [];
    const r = await verify(fakeRun({ reviews: [{ body, author_association: "OWNER" }], calls }));
    expect(r).toEqual({ ok: true, commits: 1, problems: [] });
    expect(readComments(calls)).toBe(false);
  });

  it("never reads the comments without the option", async () => {
    const calls = [];
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ calls }) });
    expect(r.problems).toEqual(["no kj review published by a member: run kj review --publish-pr 7"]);
    expect(readComments(calls)).toBe(false);
  });

  it("throws on an unknown format before asking GitHub anything", async () => {
    const calls = [];
    await expect(verify(fakeRun({ calls }), { automaticReview: "greptile" })).rejects.toThrow(/unknown automatic review format greptile.*codex-state/);
    expect(calls).toEqual([]);
  });
});
