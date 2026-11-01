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
// KJC-BUG-0470: sss4444 touches only what the signed seal vouches for (a hook + the provenance).
const NAMES = { sss4444: ".karajan/hooks/pre-push\n.karajan/supervisor-provenance.json\n", aaa1111: "a.js\n" };
const gitOf = (args) => {
  if (args[3] === "--name-only") return NAMES[args.at(-1)] ?? "";
  if (args[2] === "rev-list") return args.at(-1) === "mmm3333" ? MERGE.rev : `${args.at(-1)} p0`;
  if (args[2] === "merge-tree" || args[2] === "rev-parse") return MERGE.tree;
  return DIFFS[args.at(-1)] ?? "";
};

function fakeRun({ reviews = [], posted = [], ghDirs = [], pr = PR, labels = [] } = {}) {
  return async (cmd, args, opts) => {
    if (cmd === "gh") ghDirs.push(opts?.cwd);
    if (cmd === "gh" && (args[0] === "label" || String(args[3] ?? "").endsWith("/labels"))) { labels.push(args.join(" ")); return { exitCode: 0, stdout: "" }; }
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

  // KJC-BUG-0461 (#2315): with kj run retired, publishing the verdicts is where Karajan meets every PR.
  it("the PR gets the Karajan label, on a new publish and when the review was already there", async () => {
    for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex" });
    const labels = [];
    await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ labels }) });
    expect(labels.some((l) => l.startsWith("label create Karajan"))).toBe(true);
    expect(labels).toContain("api -X POST repos/{owner}/{repo}/issues/42/labels -f labels[]=Karajan");
    const again = [];
    const r = await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ labels: again, reviews: [{ body: "…<!-- kj-review head=bbb2222 -->", author_association: "OWNER" }] }) });
    expect(r.published).toBe(false);
    expect(again).toContain("api -X POST repos/{owner}/{repo}/issues/42/labels -f labels[]=Karajan");
  });

  it("a commit without an approved verdict: fails naming it and publishes nothing", async () => {
    await saveVerdict(dir, DIFFS.aaa1111, { verdict: "approved", reviewer: "codex" });
    await saveVerdict(dir, DIFFS.bbb2222, { verdict: "rejected", reviewer: "codex", issues: [] });
    const posted = [];
    await expect(publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted }) })).rejects.toThrow(/bbb2222 \(fix: b\)/);
    expect(posted).toHaveLength(0);
  });

  // KJC-BUG-0470: verify-pr accepts the owner's kj harden --commit as a signed act; publish-pr must too.
  it("the owner's seal commit needs no AI verdict: the review lists it as the sealed act", async () => {
    await saveVerdict(dir, DIFFS.aaa1111, { verdict: "approved", reviewer: "codex" });
    const sealed = { signed: true, complete: true, files: new Set([".karajan/hooks/pre-push"]) };
    const pr = { headRefOid: "sss4444", commits: [PR.commits[0], { oid: "sss4444", messageHeadline: "chore(harden): sealed" }] };
    const posted = [];
    expect(await publishPrReview({ projectDir: dir, pr: 42, sealed, run: fakeRun({ posted, pr }) })).toMatchObject({ published: true, commits: 1 });
    expect(posted[0].join(" ")).toMatch(/sss4444.*sealed act/s);
    // Unsigned, or a commit that is not the seal: still refused.
    await expect(publishPrReview({ projectDir: dir, pr: 42, sealed: { ...sealed, signed: false }, run: fakeRun({ pr }) })).rejects.toThrow(/sss4444/);
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
    const r = await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted, reviews: [{ body: "…<!-- kj-review head=bbb2222 -->", author_association: "OWNER" }] }) });
    expect(r).toMatchObject({ published: false, reason: expect.stringMatching(/already/) });
    expect(posted).toHaveLength(0);
  });

  // KJC-BUG-0456: verify-pr ignores a review by a non-member (another gh account), so it must not block publishing.
  it("a review for that head by a non-member does not count: it publishes again", async () => {
    for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex" });
    const posted = [];
    const r = await publishPrReview({ projectDir: dir, pr: 42, run: fakeRun({ posted, reviews: [{ body: "…<!-- kj-review head=bbb2222 -->", author_association: "NONE" }] }) });
    expect(r).toMatchObject({ published: true, commits: 2 });
    expect(posted).toHaveLength(1);
  });
});
