// HU-4907 (KJC-BUG-0666): what the batched verdict record carries, beyond the verdict itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIFF_CLIP_CHARS } from "../../src/prompts/diff-clip.js";
import { MAX_REVIEW_BATCHES } from "../../src/review/diff-batches.js";
import { runOneShotReview } from "../../src/review/one-shot-review.js";

const config = { roles: { reviewer: { provider: "codex" } } };
const approve = JSON.stringify({ approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "ok", confidence: 0.8 });
const agent = () => ({ reviewTask: vi.fn(async () => ({ ok: true, output: approve })) });
const small = "diff --git a/src/b.js b/src/b.js\n--- /dev/null\n+++ b/src/b.js\n@@ -0,0 +1 @@\n+const b = 1;";
const huge = `diff --git a/src/huge.js b/src/huge.js\n--- /dev/null\n+++ b/src/huge.js\n@@ -0,0 +1 @@\n+${"y".repeat(DIFF_CLIP_CHARS + 500)}`;

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-osr-record-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const review = (diff, reviewer, logger) => runOneShotReview({
  diff, config, logger, projectDir: dir, hostAgent: "claude",
  createAgentFn: () => reviewer, detectAgents: async () => [{ name: "codex", available: true }],
});

describe("the batched verdict record (HU-4907)", () => {
  it("keeps the batch cap the third-party review already used", () => {
    expect(MAX_REVIEW_BATCHES).toBe(10);
  });

  it("names a file no prompt can hold as a blocking issue, counts the batches and logs them", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const record = await review([small, huge].join("\n"), agent(), logger);
    expect(record.verdict).toBe("rejected");
    expect(record.batches).toBe(1);
    expect(record.reviewer).toBe("codex");
    expect(record.issues).toEqual([{
      id: "unreviewed-1", severity: "high", category: "correctness", file: "src/huge.js", line: 1,
      description: "src/huge.js is larger than one reviewer prompt: kj could not show it to the reviewer, so it is not reviewed. Split the change.",
      suggested_fix: "Split the change so each file's diff fits one prompt.",
    }]);
    expect(record.unanchored).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/reviewed whole in 1 batch/));
  });
});
