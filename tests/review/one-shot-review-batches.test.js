// HU-4906 (KJC-BUG-0666): the reviewer prompt clips the diff at DIFF_CLIP_CHARS and tells the
// reviewer to review "only what is visible". `git diff` puts apps/ before src/, so two commits of
// 25-nov (#4896, #4898) were approved having shown codex only their docs. A diff larger than one
// prompt is now reviewed whole, in batches of whole files: the verdict is approved only when every
// batch is, and a file no batch can hold is never approved unseen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIFF_CLIP_CHARS } from "../../src/prompts/diff-clip.js";
import { runOneShotReview } from "../../src/review/one-shot-review.js";

const agentsUp = (...names) => async () => names.map((name) => ({ name, available: true }));
const config = { roles: { reviewer: { provider: "codex" } } };
const verdict = (approved) => JSON.stringify({ approved, blocking_issues: approved ? [] : [{ id: "R1", severity: "high", category: "correctness", file: "src/b.js", line: 1, description: "wrong", suggested_fix: "fix" }], non_blocking_suggestions: [], summary: "s", confidence: 0.9 });

/** A file diff of about `size` characters, in many short lines. */
const fileDiff = (name, size) => {
  const lines = [`diff --git a/${name} b/${name}`, "--- /dev/null", `+++ b/${name}`, "@@ -0,0 +1,400 @@"];
  for (let i = 0; lines.join("\n").length < size; i += 1) lines.push(`+const v${i} = "${"x".repeat(40)}";`);
  return lines.join("\n");
};
const BIG = [fileDiff("apps/docs/a.md", 7000), fileDiff("src/b.js", 7000), fileDiff("src/c.js", 7000)].join("\n");

/** A reviewer that remembers every prompt and approves unless `rejectIf` matches it. */
const recorder = (rejectIf = () => false) => {
  const prompts = [];
  const agent = { reviewTask: vi.fn(async ({ prompt }) => { prompts.push(prompt); return { ok: true, output: verdict(!rejectIf(prompt)) }; }) };
  return { agent, prompts };
};

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-osr-batches-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const review = (diff, agent) => runOneShotReview({ diff, config, projectDir: dir, hostAgent: "claude", createAgentFn: () => agent, detectAgents: agentsUp("claude", "codex") });

describe("a diff larger than one prompt is reviewed whole (HU-4906)", () => {
  it("is precondition-checked: the diff is larger than the clip", () => {
    expect(BIG.length).toBeGreaterThan(DIFF_CLIP_CHARS);
  });

  it("asks the reviewer more than once, every file reaches it, and no prompt is clipped", async () => {
    const { agent, prompts } = recorder();
    const record = await review(BIG, agent);
    expect(agent.reviewTask.mock.calls.length).toBeGreaterThan(1);
    for (const file of ["apps/docs/a.md", "src/b.js", "src/c.js"]) expect(prompts.some((p) => p.includes(`diff --git a/${file} b/${file}`))).toBe(true);
    for (const p of prompts) expect(p).not.toMatch(/was clipped by kj/);
    expect(record.verdict).toBe("approved");
    expect(record.coverage).toMatchObject({ files: { reviewed: 3, total: 3 }, truncated: false });
  });

  it("one rejected batch rejects the whole diff", async () => {
    const { agent } = recorder((p) => p.includes("diff --git a/src/b.js b/src/b.js"));
    const record = await review(BIG, agent);
    expect(record.verdict).toBe("rejected");
  });

  it("a file no batch can hold is never approved unseen: the verdict is rejected and names it", async () => {
    const huge = `diff --git a/src/huge.js b/src/huge.js\n--- /dev/null\n+++ b/src/huge.js\n@@ -0,0 +1 @@\n+${"y".repeat(DIFF_CLIP_CHARS + 500)}`;
    const { agent } = recorder();
    const record = await review([fileDiff("src/b.js", 3000), huge].join("\n"), agent);
    expect(record.verdict).toBe("rejected");
    expect(record.coverage.unreviewed).toEqual(["src/huge.js"]);
    expect(JSON.stringify(record.issues)).toMatch(/src\/huge\.js/);
  });

  it("a diff that fits is still one question, with no coverage block", async () => {
    const { agent } = recorder();
    const record = await review(fileDiff("src/b.js", 2000), agent);
    expect(agent.reviewTask).toHaveBeenCalledOnce();
    expect(record.verdict).toBe("approved");
    expect(record.coverage).toBeUndefined();
  });
});
