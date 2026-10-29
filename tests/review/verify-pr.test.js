// KJC-TSK-1088: CI checks that every commit of a PR carries its cross-AI verdict,
// as published by kj review --publish-pr: one review for the PR's head, from a
// member of the repo, listing each commit with the hash of the diff it brought.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishPrReview } from "../../src/review/publish-pr.js";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { saveVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DIFFS = { aaa1111: "diff --git a/a.js b/a.js\n+const a = 1;\n", bbb2222: "diff --git a/b.js b/b.js\n+const b = 2;\n" };
const PR = { headRefOid: "bbb2222", commits: [{ oid: "aaa1111", messageHeadline: "feat: a" }, { oid: "bbb2222", messageHeadline: "fix: b" }] };

// KJC-BUG-0391: merges, as {sha: {parents, tree, merged}}; merged is what git merge-tree gives.
function fakeGit(args, diffs, merges, names = {}) {
  const sub = args[2];
  if (args.includes("--name-only")) return { exitCode: 0, stdout: (names[args.at(-1)] ?? ["x.js"]).join("\n") };
  if (sub === "rev-list") return { exitCode: 0, stdout: [args.at(-1), ...(merges[args.at(-1)]?.parents ?? ["p0"])].join(" ") };
  if (sub === "rev-parse") return { exitCode: 0, stdout: merges[args.at(-1).replace("^{tree}", "")]?.tree ?? "" };
  if (sub === "merge-tree") return Object.values(merges).find((m) => m.parents.join() === args.slice(-2).join())?.merged ?? { exitCode: 1, stdout: "" };
  return { exitCode: 0, stdout: diffs[args.at(-1)] ?? "" };
}

function fakeRun({ reviews = [], posted = [], diffs = DIFFS, pr = PR, merges = {}, names = {} } = {}) {
  return async (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(pr) };
    if (cmd === "git") return fakeGit(args, diffs, merges, names);
    if (cmd === "gh" && args.includes("POST")) { posted.push(args); return { exitCode: 0, stdout: "{}" }; }
    if (cmd === "gh" && args.includes("--jq")) return { exitCode: 0, stdout: reviews.map((r) => JSON.stringify(r)).join("\n") };
    if (cmd === "gh" && args[0] === "api") return { exitCode: 0, stdout: "[]" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}

/** The review body kj review --publish-pr posts for PR, so both sides read the same format. */
async function publishedBody() {
  for (const diff of Object.values(DIFFS)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex", summary: "ok (diff deadbeef0000) inside" });
  const posted = [];
  await publishPrReview({ projectDir: dir, pr: 7, run: fakeRun({ posted }) });
  return posted[0].find((a) => a.startsWith("body=")).slice("body=".length);
}

describe("verifyPrReview", () => {
  it("passes when a member's kj review for the head lists every commit with its diff hash", async () => {
    const body = await publishedBody();
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "OWNER" }] }) });
    expect(r).toEqual({ ok: true, commits: 2, problems: [] });
  });

  it("fails naming the commit whose diff no longer matches the published hash", async () => {
    const body = await publishedBody();
    const diffs = { ...DIFFS, aaa1111: "diff --git a/a.js b/a.js\n+const a = 9;\n" };
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "MEMBER" }], diffs }) });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([expect.stringMatching(/aaa1111 \(feat: a\)/)]);
  });

  // KJC-BUG-0386 (#2283): git abbreviates the index lines by the clone's object count.
  it("passes when this clone abbreviates the index lines to another length than the publisher's", async () => {
    const as = (len) => Object.fromEntries(Object.entries(DIFFS).map(([sha, d]) => [sha, `index ${"0".repeat(len)}..${"a".repeat(len)}\n${d}`]));
    const seenByPublisher = as(9);
    for (const diff of Object.values(seenByPublisher)) await saveVerdict(dir, diff, { verdict: "approved", reviewer: "codex" });
    const posted = [];
    await publishPrReview({ projectDir: dir, pr: 7, run: fakeRun({ posted, diffs: seenByPublisher }) });
    const body = posted[0].find((a) => a.startsWith("body=")).slice("body=".length);
    const ci = fakeRun({ reviews: [{ body, author_association: "OWNER" }], diffs: as(7) });
    const run = async (cmd, args, opts) => (cmd === "git" && args.includes("--abbrev=9") ? { exitCode: 0, stdout: seenByPublisher[args.at(-1)] } : ci(cmd, args, opts));
    expect(await verifyPrReview({ projectDir: dir, pr: 7, run })).toEqual({ ok: true, commits: 2, problems: [] });
  });

  it("fails when no kj review was published on the PR", async () => {
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [] }) });
    expect(r).toMatchObject({ ok: false, problems: [expect.stringMatching(/no kj review published by a member/)] });
  });

  // KJC-BUG-0391: "Update branch" puts a merge of main on top. A clean merge brings no work of
  // the PR, so it needs no verdict, and the review published for the earlier head still proves
  // every commit (the diff hashes do); a merge that resolved conflicts by hand still needs one.
  const MERGED = { ...PR, headRefOid: "mmm3333", commits: [...PR.commits, { oid: "mmm3333", messageHeadline: "Merge branch 'main'" }] };
  it("passes over a clean merge of main with the review published for the earlier head", async () => {
    const body = await publishedBody();
    const merges = { mmm3333: { parents: ["bbb2222", "main000"], tree: "t1", merged: { exitCode: 0, stdout: "t1\n" } } };
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "OWNER" }], pr: MERGED, merges }) });
    expect(r).toEqual({ ok: true, commits: 3, problems: [] });
  });

  it("still asks a verdict of a merge whose tree is not the clean merge of its parents", async () => {
    const body = await publishedBody();
    const merges = { mmm3333: { parents: ["bbb2222", "main000"], tree: "t2", merged: { exitCode: 0, stdout: "t1\n" } } };
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "OWNER" }], pr: MERGED, merges }) });
    expect(r.problems).toEqual([expect.stringMatching(/mmm3333/)]);
  });

  it("ignores a kj review written by someone who is not a member of the repo", async () => {
    const body = await publishedBody();
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "CONTRIBUTOR" }] }) });
    expect(r.ok).toBe(false);
  });

  it("fails naming a commit the review does not list", async () => {
    const body = (await publishedBody()).split("\n").filter((l) => !l.includes("aaa1111")).join("\n");
    const r = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun({ reviews: [{ body, author_association: "COLLABORATOR" }] }) });
    expect(r.problems).toEqual([expect.stringMatching(/aaa1111/)]);
  });

  // KJC-BUG-0388: kj harden --commit is the human's act, signed from the phone; no AI reviews it.
  describe("the seal commit", () => {
    const HOOK = [".karajan", "hooks", "pre-commit"].join("/");
    const PROV = ".karajan/supervisor-provenance.json";
    const unlisted = async () => (await publishedBody()).split("\n").filter((l) => !l.includes("aaa1111")).join("\n");
    const verify = async (names, sealed) => verifyPrReview({ projectDir: dir, pr: 7, sealed, run: fakeRun({ reviews: [{ body: await unlisted(), author_association: "OWNER" }], names }) });
    const signedSeal = { files: new Set([HOOK]), complete: true, signed: true };

    it("needs no verdict when it only touches files the roster-signed seal vouches for, and is named", async () => {
      const r = await verify({ aaa1111: [HOOK, PROV] }, signedSeal);
      expect(r).toMatchObject({ ok: true, problems: [], sealCommits: ["aaa1111"] });
    });

    it("a PR that only brings the seal needs no published review; anything else without one is told to publish it", async () => {
      const pr = { headRefOid: "aaa1111", commits: [{ oid: "aaa1111", messageHeadline: "chore(harden): sealed" }] };
      const seal = await verifyPrReview({ projectDir: dir, pr: 7, sealed: signedSeal, run: fakeRun({ pr, names: { aaa1111: [HOOK, PROV] } }) });
      expect(seal).toMatchObject({ ok: true, sealCommits: ["aaa1111"] });
      const code = await verifyPrReview({ projectDir: dir, pr: 7, sealed: signedSeal, run: fakeRun({ names: { aaa1111: [HOOK, PROV] } }) });
      expect(code).toMatchObject({ ok: false, problems: [expect.stringMatching(/no kj review published/)] });
    });

    it("still needs one when the seal is unsigned, incomplete, or the commit touches anything else", async () => {
      for (const [names, sealed] of [
        [{ aaa1111: [HOOK, PROV] }, { ...signedSeal, signed: false }],
        [{ aaa1111: [HOOK, PROV] }, { ...signedSeal, complete: false }],
        [{ aaa1111: [HOOK, "src/a.js"] }, signedSeal],
        [{ aaa1111: [] }, signedSeal],
      ]) {
        expect((await verify(names, sealed)).problems, JSON.stringify(names)).toEqual([expect.stringMatching(/aaa1111/)]);
      }
    });
  });
});
