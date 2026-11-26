// HU-4920 (KJC-TSK-1806, point 1 of #4891): an agent merged PRs whose checks were green while a
// second AI reviewer had requested changes on them. verify-pr now fails while a reviewer's latest
// review is CHANGES_REQUESTED; a later approval or a dismissal resolves it, a comment does not.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { publishPrReview } from "../../src/review/publish-pr.js";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-cr-")); execFileSync("git", ["init", "-q", dir]); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DIFF = "diff --git a/a.js b/a.js\n+const a = 1;\n";
const PR = { headRefOid: "aaa1111", commits: [{ oid: "aaa1111", messageHeadline: "feat: a" }] };

function fakeRun({ reviews = [], posted = [], jq = [] } = {}) {
  return async (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(PR) };
    if (cmd === "git" && args.includes("--name-only")) return { exitCode: 0, stdout: "x.js" };
    if (cmd === "git" && args[2] === "rev-list") return { exitCode: 0, stdout: `${args.at(-1)} p0` };
    if (cmd === "git") return { exitCode: 0, stdout: DIFF };
    if (cmd === "gh" && args.includes("POST")) { posted.push(args); return { exitCode: 0, stdout: "{}" }; }
    if (cmd === "gh" && args.includes("--jq")) { jq.push(args.at(-1)); return { exitCode: 0, stdout: reviews.map((r) => JSON.stringify(r)).join("\n") }; }
    if (cmd === "gh" && args[0] === "api") return { exitCode: 0, stdout: "[]" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}

/** kj's own published review for the PR, approved: it carries state COMMENTED, as GitHub gives it. */
async function kjReview() {
  await saveVerdict(dir, DIFF, { verdict: "approved", reviewer: "codex", sonar: { ran: true, covered: ["x.js"] }, summary: "ok" });
  const posted = [];
  await publishPrReview({ projectDir: dir, pr: 7, run: fakeRun({ posted }) });
  const body = posted[0].find((a) => a.startsWith("body=")).slice("body=".length);
  return { body, author_association: "OWNER", user: { login: "owner" }, state: "COMMENTED" };
}
const review = (login, state) => ({ body: "", author_association: "NONE", user: { login }, state });

describe("verify-pr and the reviews that request changes (HU-4920)", () => {
  it("asks GitHub for the state of every review", async () => {
    const jq = [];
    await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [await kjReview()], jq }) });
    expect(jq[0]).toContain("state");
  });

  it("fails while a reviewer's latest review requests changes, naming the reviewer and the way out", async () => {
    const reviews = [await kjReview(), review("ai-reviewer[bot]", "CHANGES_REQUESTED")];
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews }) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([
      "ai-reviewer[bot] requested changes and has not approved since: it is resolved when they approve again or the review is dismissed with a reason",
    ]);
  });

  it("a later approval by the same reviewer resolves it", async () => {
    const reviews = [await kjReview(), review("alice", "CHANGES_REQUESTED"), review("alice", "APPROVED")];
    expect(await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews }) })).toEqual({ ok: true, commits: 1, problems: [] });
  });

  it("a dismissed review no longer counts", async () => {
    const reviews = [await kjReview(), review("alice", "DISMISSED")];
    expect((await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews }) })).ok).toBe(true);
  });

  it("a comment after the request does not resolve it", async () => {
    const reviews = [await kjReview(), review("alice", "CHANGES_REQUESTED"), review("alice", "COMMENTED")];
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews }) });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^alice requested changes/);
  });

  it("another reviewer's approval does not resolve it", async () => {
    const reviews = [await kjReview(), review("alice", "CHANGES_REQUESTED"), review("bob", "APPROVED")];
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews }) });
    expect(r.problems).toEqual([expect.stringMatching(/^alice requested changes/)]);
  });

  it("is reported next to the missing kj review, not instead of it", async () => {
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [review("alice", "CHANGES_REQUESTED")] }) });
    expect(r.problems.length).toBeGreaterThan(1);
    expect(r.problems.at(-1)).toMatch(/^alice requested changes/);
  });
});
