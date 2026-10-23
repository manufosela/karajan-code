// KJC-TSK-0913: the cross-AI verdict kj already holds for each commit of a PR is
// published as ONE GitHub review (it counts in reviews.totalCount), never as a
// loose comment, never duplicated, and never when a commit has no verdict.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishPrReview } from "../../src/review/publish-pr.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-publish-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DIFFS = { aaa1111: "diff --git a/a.js b/a.js\n+const a = 1;\n", bbb2222: "diff --git a/b.js b/b.js\n+const b = 2;\n" };
const PR = { headRefOid: "bbb2222", commits: [{ oid: "aaa1111", messageHeadline: "feat: a" }, { oid: "bbb2222", messageHeadline: "fix: b" }] };

// KJC-BUG-0391: mmm3333 is a clean merge of main (its tree is what git merge-tree gives).
const MERGE = { rev: "mmm3333 bbb2222 main000", tree: "t1" };
const gitOf = (args) => {
  if (args[2] === "rev-list") return args.at(-1) === "mmm3333" ? MERGE.rev : `${args.at(-1)} p0`;
  if (args[2] === "merge-tree" || args[2] === "rev-parse") return MERGE.tree;
  return DIFFS[args.at(-1)] ?? "";
};

function fakeRun({ reviews = [], posted = [], ghDirs = [], pr = PR } = {}) {
  return async (cmd, args, opts) => {
    if (cmd === "gh") ghDirs.push(opts?.cwd);
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(pr) };
    if (cmd === "git") return { exitCode: 0, stdout: gitOf(args) };
    if (cmd === "gh" && args.includes("POST")) { posted.push(args); return { exitCode: 0, stdout: "{}" }; }
    if (cmd === "gh" && args[0] === "api") return { exitCode: 0, stdout: JSON.stringify(reviews) };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}

describe("publishPrReview", () => {
  it("every commit with an approved verdict: one review with event COMMENT, each commit, reviewer and diff hash", async () => {
    for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex", summary: "looks right" });
    const posted = [];
    const ghDirs = [];
    const r = await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted, ghDirs }) });
    expect(r).toMatchObject({ published: true, commits: 2 });
    expect(posted).toHaveLength(1);
    expect(new Set(ghDirs)).toEqual(new Set([dir])); // every gh call targets the project's own repo
    const args = posted[0].join(" ");
    expect(args).toMatch(/repos\/\{owner\}\/\{repo\}\/pulls\/42\/reviews/);
    expect(args).toMatch(/event=COMMENT/);
    expect(args).toMatch(/commit_id=bbb2222/);
    expect(args).toMatch(/aaa1111.*feat: a.*codex/s);
    expect(args).toMatch(/kj-review head=bbb2222/);
  });

  it("a commit without an approved verdict: fails naming it and publishes nothing", async () => {
    await saveVerdict(dir, DIFFS.aaa1111, { verdict: "approved", reviewer: "codex" });
    await saveVerdict(dir, DIFFS.bbb2222, { verdict: "rejected", reviewer: "codex", issues: [] });
    const posted = [];
    await expect(publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted }) })).rejects.toThrow(/bbb2222 \(fix: b\)/);
    expect(posted).toHaveLength(0);
  });

  it("a clean merge of main on top needs no verdict and is not listed", async () => {
    for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex" });
    const posted = [];
    const pr = { headRefOid: "mmm3333", commits: [...PR.commits, { oid: "mmm3333", messageHeadline: "Merge branch 'main'" }] };
    expect(await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted, pr }) })).toMatchObject({ published: true, commits: 2 });
    expect(posted[0].join(" ")).not.toMatch(/`mmm3333`/);
  });

  it("already published for that head: it does not duplicate the review", async () => {
    for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex" });
    const posted = [];
    const r = await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted, reviews: [{ body: "…<!-- kj-review head=bbb2222 -->" }] }) });
    expect(r).toMatchObject({ published: false, reason: expect.stringMatching(/already/) });
    expect(posted).toHaveLength(0);
  });
});
