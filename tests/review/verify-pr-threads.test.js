// HU-4930 (KJC-TSK-1808): verify-pr adds the PR's unresolved review threads to its problems,
// judged against the PR's author as gh pr view gives it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { publishPrReview } from "../../src/review/publish-pr.js";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-threads-")); execFileSync("git", ["init", "-q", dir]); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DIFF = "diff --git a/a.js b/a.js\n+const a = 1;\n";
const PR = { headRefOid: "aaa1111", author: { login: "alice" }, commits: [{ oid: "aaa1111", messageHeadline: "feat: a" }] };

function fakeRun({ reviews = [], threads = [], posted = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(PR) };
    if (cmd === "gh" && args[1] === "graphql") return { exitCode: 0, stdout: threads.map((t) => JSON.stringify(t)).join("\n") };
    if (cmd === "git" && args.includes("--name-only")) return { exitCode: 0, stdout: "x.js" };
    if (cmd === "git" && args[2] === "rev-list") return { exitCode: 0, stdout: `${args.at(-1)} p0` };
    if (cmd === "git") return { exitCode: 0, stdout: DIFF };
    if (cmd === "gh" && args.includes("POST")) { posted.push(args); return { exitCode: 0, stdout: "{}" }; }
    if (cmd === "gh" && args.includes("--jq")) return { exitCode: 0, stdout: reviews.map((r) => JSON.stringify(r)).join("\n") };
    if (cmd === "gh" && args[0] === "api") return { exitCode: 0, stdout: "[]" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}

async function kjReview() {
  await saveVerdict(dir, DIFF, { verdict: "approved", reviewer: "codex", sonar: { ran: true, covered: ["x.js"] }, summary: "ok" });
  const posted = [];
  await publishPrReview({ projectDir: dir, pr: 7, run: fakeRun({ posted }) });
  const body = posted[0].find((a) => a.startsWith("body=")).slice("body=".length);
  return { body, author_association: "OWNER", user: { login: "owner" }, state: "COMMENTED" };
}
const open = (author) => ({ isResolved: false, isOutdated: false, path: "src/a.js", line: 3, author });

describe("verify-pr and unresolved review threads (HU-4930)", () => {
  it("fails on a reviewer's unresolved thread, after the other problems", async () => {
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [await kjReview()], threads: [open("ai-reviewer[bot]")] }) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(["src/a.js:3 has an unresolved review thread by ai-reviewer[bot]: resolve it on the PR"]);
  });

  it("the PR author's own thread does not count", async () => {
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [await kjReview()], threads: [open("alice")] }) });
    expect(r).toEqual({ ok: true, commits: 1, problems: [] });
  });
});
