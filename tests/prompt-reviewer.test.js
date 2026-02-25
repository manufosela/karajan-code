import { describe, expect, it } from "vitest";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";

describe("buildReviewerPrompt", () => {
  const baseArgs = {
    task: "Add login feature",
    diff: "diff --git a/src/auth.js\n+export function login() {}",
    reviewRules: "Check for security issues",
    mode: "standard"
  };

  it("includes subagent preamble", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("You are running as a Karajan sub-agent");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("includes review mode", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("You are a code reviewer in standard mode");
  });

  it("includes JSON schema instruction", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("Return only one valid JSON object and nothing else");
    expect(result).toContain('"approved":boolean');
    expect(result).toContain('"blocking_issues"');
    expect(result).toContain('"non_blocking_suggestions"');
    expect(result).toContain('"summary":string');
    expect(result).toContain('"confidence":number');
  });

  it("includes task context", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("Task context:\nAdd login feature");
  });

  it("includes review rules", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("Review rules:\nCheck for security issues");
  });

  it("includes git diff", () => {
    const result = buildReviewerPrompt(baseArgs);

    expect(result).toContain("Git diff:\ndiff --git a/src/auth.js");
  });

  it("truncates diff larger than 12KB", () => {
    const largeDiff = "x".repeat(15000);
    const result = buildReviewerPrompt({ ...baseArgs, diff: largeDiff });

    expect(result).toContain("[TRUNCATED]");
    expect(result).not.toContain("x".repeat(15000));
    // Truncated portion should be 12000 chars
    const diffSection = result.split("Git diff:\n")[1];
    expect(diffSection).toContain("x".repeat(12000));
  });

  it("does not truncate diff at exactly 12KB", () => {
    const exactDiff = "y".repeat(12000);
    const result = buildReviewerPrompt({ ...baseArgs, diff: exactDiff });

    expect(result).not.toContain("[TRUNCATED]");
    expect(result).toContain("y".repeat(12000));
  });

  it("does not truncate diff smaller than 12KB", () => {
    const smallDiff = "z".repeat(5000);
    const result = buildReviewerPrompt({ ...baseArgs, diff: smallDiff });

    expect(result).not.toContain("[TRUNCATED]");
    expect(result).toContain("z".repeat(5000));
  });

  it("supports different review modes", () => {
    const paranoid = buildReviewerPrompt({ ...baseArgs, mode: "paranoid" });
    const relaxed = buildReviewerPrompt({ ...baseArgs, mode: "relaxed" });

    expect(paranoid).toContain("You are a code reviewer in paranoid mode");
    expect(relaxed).toContain("You are a code reviewer in relaxed mode");
  });

  it("sections are separated by double newlines", () => {
    const result = buildReviewerPrompt(baseArgs);
    const sections = result.split("\n\n");

    // preamble, mode, JSON instruction, schema, task, rules, diff = at least 7
    expect(sections.length).toBeGreaterThanOrEqual(7);
  });
});
