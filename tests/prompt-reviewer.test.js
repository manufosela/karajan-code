import { describe, expect, it } from "vitest";
import { buildReviewerPrompt, buildReviewerPromptLayout } from "../src/prompts/reviewer.js";

describe("buildReviewerPromptLayout (Φ1 — prefix caching)", () => {
  const baseArgs = {
    reviewRules: "Check for security issues",
    mode: "standard",
    productContext: "A CLI tool",
  };

  it("keeps the stable block byte-identical across different task and diff", async () => {
    const a = await buildReviewerPromptLayout({ ...baseArgs, task: "Add login", diff: "+a" });
    const b = await buildReviewerPromptLayout({ ...baseArgs, task: "Fix logout", diff: "+b" });

    expect(a.stable).toBe(b.stable);
    expect(a.volatile).not.toBe(b.volatile);
  });

  it("puts review rules and contexts in the stable block, task + diff last", async () => {
    const layout = await buildReviewerPromptLayout({ ...baseArgs, task: "Add login", diff: "+x" });

    expect(layout.stable).toContain("Review rules:\nCheck for security issues");
    expect(layout.stable).toContain("## Product Context");
    expect(layout.volatile).toContain("Task context:\nAdd login");
    expect(layout.volatile).toContain("Git diff:\n+x");
    expect(layout.volatile.indexOf("Task context:")).toBeLessThan(layout.volatile.indexOf("Git diff:"));
  });

  it("buildReviewerPrompt renders the git diff as the final section", async () => {
    const full = await buildReviewerPrompt({ ...baseArgs, task: "Add login", diff: "+final" });
    expect(full.endsWith("Git diff:\n+final")).toBe(true);
  });
});

describe("buildReviewerPrompt", () => {
  const baseArgs = {
    task: "Add login feature",
    diff: "diff --git a/src/auth.js\n+export function login() {}",
    reviewRules: "Check for security issues",
    mode: "standard"
  };

  it("includes subagent preamble", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("You are running as a Karajan sub-agent");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("includes review mode", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("You are a code reviewer in standard mode");
  });

  it("includes JSON schema instruction", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("Return only one valid JSON object and nothing else");
    expect(result).toContain('"approved":boolean');
    expect(result).toContain('"blocking_issues"');
    expect(result).toContain('"non_blocking_suggestions"');
    expect(result).toContain('"summary":string');
    expect(result).toContain('"confidence":number');
  });

  it("includes task context", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("Task context:\nAdd login feature");
  });

  it("includes review rules", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("Review rules:\nCheck for security issues");
  });

  it("includes git diff", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).toContain("Git diff:\ndiff --git a/src/auth.js");
  });

  // KJC-BUG-0134 (issue #1381): a bare [TRUNCATED] inside the diff body reads
  // as file content — reviewers blamed whichever file the cut landed in and
  // rejected complete, untouched code. The clip is DECLARED as kj's own,
  // outside the diff, with the order not to reason about completeness.
  it("clips diffs larger than 12KB with a note attributed to kj — never a bare marker", async () => {
    const line = "+a changed line of code xxxx\n";
    const largeDiff = line.repeat(600); // ~17KB of newline-terminated lines
    const result = await buildReviewerPrompt({ ...baseArgs, diff: largeDiff });

    expect(result).not.toContain("[TRUNCATED]");
    expect(result).toContain("clipped by kj");
    expect(result).toContain("not part of the diff");
    expect(result).toMatch(/\d+ more line/);
    // The cut lands on a line boundary — no half-line artifacts to misread.
    const diffSection = result.split("Git diff:\n")[1].split("\n\nNOTE FROM")[0];
    expect(diffSection.endsWith(line.trimEnd())).toBe(true);
  });

  it("a diff with no newlines still clips hard at the limit", async () => {
    const result = await buildReviewerPrompt({ ...baseArgs, diff: "x".repeat(15000) });
    expect(result).toContain("clipped by kj");
    expect(result).not.toContain("x".repeat(12001));
  });

  it("does not clip a diff at exactly 12KB", async () => {
    const exactDiff = "y".repeat(12000);
    const result = await buildReviewerPrompt({ ...baseArgs, diff: exactDiff });

    expect(result).not.toContain("clipped by kj");
    expect(result).toContain("y".repeat(12000));
  });

  // KJC-BUG-0138: a split diff carries the moved-lines correlation to the
  // reviewer so a relocation is never read as a coverage deletion.
  it("a file-split diff includes the kj split signal", async () => {
    const moved = Array.from({ length: 15 }, (_, i) => `  expect(thing(${i})).toBe(out[${i}]);`);
    const splitDiff = [
      "--- a/tests/big.test.js",
      "+++ b/tests/big.test.js",
      ...moved.map((l) => `-${l}`),
      "--- /dev/null",
      "+++ b/tests/extracted.test.js",
      ...moved.map((l) => `+${l}`),
    ].join("\n");
    const result = await buildReviewerPrompt({ ...baseArgs, diff: splitDiff });
    expect(result).toContain("MOVES content between files");
    expect(result).toContain("tests/extracted.test.js (15)");
  });

  it("does not clip a diff smaller than 12KB", async () => {
    const smallDiff = "z".repeat(5000);
    const result = await buildReviewerPrompt({ ...baseArgs, diff: smallDiff });

    expect(result).not.toContain("clipped by kj");
    expect(result).toContain("z".repeat(5000));
  });

  it("supports different review modes", async () => {
    const paranoid = await buildReviewerPrompt({ ...baseArgs, mode: "paranoid" });
    const relaxed = await buildReviewerPrompt({ ...baseArgs, mode: "relaxed" });

    expect(paranoid).toContain("You are a code reviewer in paranoid mode");
    expect(relaxed).toContain("You are a code reviewer in relaxed mode");
  });

  it("sections are separated by double newlines", async () => {
    const result = await buildReviewerPrompt(baseArgs);
    const sections = result.split("\n\n");

    // preamble, mode, JSON instruction, schema, task, rules, diff = at least 7
    expect(sections.length).toBeGreaterThanOrEqual(7);
  });

  it("includes Serena instructions when serenaEnabled is true", async () => {
    const result = await buildReviewerPrompt({ ...baseArgs, serenaEnabled: true });

    expect(result).toContain("Serena MCP");
    expect(result).toContain("find_symbol");
    expect(result).toContain("find_referencing_symbols");
    expect(result).not.toContain("Do NOT use any MCP tools");
  });

  it("does not include Serena instructions by default", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).not.toContain("Serena MCP");
    expect(result).not.toContain("find_symbol");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("does not include Serena when serenaEnabled is false", async () => {
    const result = await buildReviewerPrompt({ ...baseArgs, serenaEnabled: false });

    expect(result).not.toContain("Serena MCP");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("includes RTK instructions when rtkAvailable is true", async () => {
    const result = await buildReviewerPrompt({ ...baseArgs, rtkAvailable: true });

    expect(result).toContain("Token Optimization (RTK detected)");
    expect(result).toContain("rtk git status");
    expect(result).toContain("rtk git diff");
    expect(result).toContain("does NOT apply to non-Bash tools");
  });

  it("does not include RTK instructions by default", async () => {
    const result = await buildReviewerPrompt(baseArgs);

    expect(result).not.toContain("RTK");
    expect(result).not.toContain("Token Optimization");
  });

  it("does not include RTK instructions when rtkAvailable is false", async () => {
    const result = await buildReviewerPrompt({ ...baseArgs, rtkAvailable: false });

    expect(result).not.toContain("RTK");
    expect(result).not.toContain("Token Optimization");
  });
});
