// HU-4944 (KJC-BUG-0673): each batch got the verified facts of the whole diff, so the reviewer
// rejected it as incomplete: files named in the facts were missing from the diff it was shown.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runOneShotReview } from "../../src/review/one-shot-review.js";

const config = { roles: { reviewer: { provider: "codex" } } };
const approval = JSON.stringify({ approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "s", confidence: 0.9 });
const fileDiff = (name, size, from = name) => {
  const lines = [`diff --git a/${from} b/${name}`, `--- a/${from}`, `+++ b/${name}`, "@@ -0,0 +1,400 @@"];
  for (let i = 0; lines.join("\n").length < size; i += 1) lines.push(`+const v${i} = "${"x".repeat(40)}";`);
  return lines.join("\n");
};
const FILES = ["src/a.js", "src/b.js", "src/c.js"];

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-osr-batch-facts-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const review = async (diff) => {
  const prompts = [];
  const agent = { reviewTask: vi.fn(async ({ prompt }) => { prompts.push(prompt); return { ok: true, output: approval }; }) };
  const record = await runOneShotReview({ diff, config, projectDir: dir, hostAgent: "claude", createAgentFn: () => agent, detectAgents: async () => [{ name: "codex", available: true }] });
  return { record, prompts };
};
const factsOf = (prompt) => prompt.slice(prompt.indexOf("## Verified facts"), prompt.indexOf("Git diff:\n"));
const shownIn = (prompt) => FILES.filter((f) => prompt.includes(` b/${f}\n`));

describe("each batch gets only the facts of what it shows (HU-4944)", () => {
  it("lists the batch's files, the diff-wide facts and which batch it is", async () => {
    const { record, prompts } = await review(FILES.map((f) => fileDiff(f, 7000)).join("\n"));
    expect(prompts.length).toBeGreaterThan(1);
    prompts.forEach((prompt, i) => {
      const facts = factsOf(prompt);
      const shown = shownIn(prompt);
      for (const file of FILES) expect(facts.includes(`- ${file} +`)).toBe(shown.includes(file));
      expect(facts).toContain("no test file is touched");
      expect(facts).toContain(`This prompt shows batch ${i + 1} of ${prompts.length} (files: ${shown.join(", ")}); the diff's other files are reviewed in other prompts.`);
    });
    for (const file of FILES) expect(record.facts.some((f) => f.file === file)).toBe(true);
  });

  it("keeps the facts of a renamed file in its batch", async () => {
    const { prompts } = await review([fileDiff("src/a.js", 7000), fileDiff("src/b.js", 7000, "src/old.js")].join("\n"));
    expect(factsOf(prompts[1])).toContain("- src/b.js +");
  });

  it("a diff that fits one prompt has every fact and no batch line", async () => {
    const { prompts } = await review(FILES.map((f) => fileDiff(f, 1000)).join("\n"));
    expect(prompts).toHaveLength(1);
    for (const file of FILES) expect(factsOf(prompts[0])).toContain(`- ${file} +`);
    expect(prompts[0]).not.toContain("This prompt shows batch");
  });
});
