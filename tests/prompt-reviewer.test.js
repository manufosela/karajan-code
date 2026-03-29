import { describe, expect, it } from "vitest";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";

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

  it("truncates diff larger than 12KB", async () => {
    const largeDiff = "x".repeat(15000);
    const result = await buildReviewerPrompt({ ...baseArgs, diff: largeDiff });

    expect(result).toContain("[TRUNCATED]");
    expect(result).not.toContain("x".repeat(15000));
    // Truncated portion should be 12000 chars
    const diffSection = result.split("Git diff:\n")[1];
    expect(diffSection).toContain("x".repeat(12000));
  });

  it("does not truncate diff at exactly 12KB", async () => {
    const exactDiff = "y".repeat(12000);
    const result = await buildReviewerPrompt({ ...baseArgs, diff: exactDiff });

    expect(result).not.toContain("[TRUNCATED]");
    expect(result).toContain("y".repeat(12000));
  });

  it("does not truncate diff smaller than 12KB", async () => {
    const smallDiff = "z".repeat(5000);
    const result = await buildReviewerPrompt({ ...baseArgs, diff: smallDiff });

    expect(result).not.toContain("[TRUNCATED]");
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
