import { describe, expect, it } from "vitest";
import { buildCoderPrompt } from "../src/prompts/coder.js";

describe("buildCoderPrompt", () => {
  it("includes task and default TDD instructions", async () => {
    const result = await buildCoderPrompt({ task: "Add login feature" });

    expect(result).toContain("Task:\nAdd login feature");
    expect(result).toContain("Default development policy: TDD");
    expect(result).toContain("Add or update failing tests first");
    expect(result).toContain("Implement minimal code to make tests pass");
    expect(result).toContain("Refactor safely while keeping tests green");
  });

  it("includes subagent preamble", async () => {
    const result = await buildCoderPrompt({ task: "Fix bug" });

    expect(result).toContain("You are running as a Karajan sub-agent");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("omits TDD instructions when methodology is not tdd", async () => {
    const result = await buildCoderPrompt({ task: "Fix bug", methodology: "standard" });

    expect(result).not.toContain("Default development policy: TDD");
    expect(result).toContain("Task:\nFix bug");
  });

  it("includes coder rules when provided", async () => {
    const result = await buildCoderPrompt({
      task: "Refactor module",
      coderRules: "Always use arrow functions"
    });

    expect(result).toContain("Coder rules (MUST follow):\nAlways use arrow functions");
  });

  it("includes sonar summary when provided", async () => {
    const result = await buildCoderPrompt({
      task: "Fix issues",
      sonarSummary: "3 blocker issues found in auth.js"
    });

    expect(result).toContain("Sonar summary:\n3 blocker issues found in auth.js");
  });

  it("includes reviewer feedback when provided", async () => {
    const result = await buildCoderPrompt({
      task: "Update API",
      reviewerFeedback: "Missing input validation on POST /users"
    });

    expect(result).toContain("Reviewer blocking feedback:\nMissing input validation on POST /users");
  });

  it("includes all optional sections together", async () => {
    const result = await buildCoderPrompt({
      task: "Complete rewrite",
      coderRules: "Follow SOLID",
      sonarSummary: "2 critical issues",
      reviewerFeedback: "Tests missing for edge case",
      methodology: "tdd"
    });

    expect(result).toContain("Task:\nComplete rewrite");
    expect(result).toContain("Coder rules (MUST follow):\nFollow SOLID");
    expect(result).toContain("Default development policy: TDD");
    expect(result).toContain("Sonar summary:\n2 critical issues");
    expect(result).toContain("Reviewer blocking feedback:\nTests missing for edge case");
  });

  it("sections are separated by double newlines", async () => {
    const result = await buildCoderPrompt({
      task: "Test task",
      sonarSummary: "issue",
      reviewerFeedback: "feedback"
    });

    const sections = result.split("\n\n");
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  it("omits null/undefined optional sections", async () => {
    const result = await buildCoderPrompt({
      task: "Simple task",
      coderRules: null,
      sonarSummary: undefined,
      reviewerFeedback: null
    });

    expect(result).not.toContain("Coder rules");
    expect(result).not.toContain("Sonar summary");
    expect(result).not.toContain("Reviewer blocking feedback");
  });

  it("includes Serena instructions when serenaEnabled is true", async () => {
    const result = await buildCoderPrompt({ task: "Navigate code", serenaEnabled: true });

    expect(result).toContain("Serena MCP");
    expect(result).toContain("find_symbol");
    expect(result).toContain("find_referencing_symbols");
    expect(result).toContain("insert_after_symbol");
    expect(result).not.toContain("Do NOT use any MCP tools");
  });

  it("does not include Serena instructions by default", async () => {
    const result = await buildCoderPrompt({ task: "Normal task" });

    expect(result).not.toContain("Serena MCP");
    expect(result).not.toContain("find_symbol");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("does not include Serena when serenaEnabled is false", async () => {
    const result = await buildCoderPrompt({ task: "Normal task", serenaEnabled: false });

    expect(result).not.toContain("Serena MCP");
    expect(result).toContain("Do NOT use any MCP tools");
  });

  it("includes subprocess constraints about non-interactive execution", async () => {
    const result = await buildCoderPrompt({ task: "Init project" });

    expect(result).toContain("non-interactive subprocess");
    expect(result).toContain("--yes");
    expect(result).toContain("will hang forever");
  });

  it("includes RTK instructions when rtkAvailable is true", async () => {
    const result = await buildCoderPrompt({ task: "Fix tests", rtkAvailable: true });

    expect(result).toContain("Token Optimization (RTK detected)");
    expect(result).toContain("rtk git status");
    expect(result).toContain("rtk git diff");
    expect(result).toContain("does NOT apply to non-Bash tools");
  });

  it("does not include RTK instructions by default", async () => {
    const result = await buildCoderPrompt({ task: "Normal task" });

    expect(result).not.toContain("RTK");
    expect(result).not.toContain("Token Optimization");
  });

  it("does not include RTK instructions when rtkAvailable is false", async () => {
    const result = await buildCoderPrompt({ task: "Normal task", rtkAvailable: false });

    expect(result).not.toContain("RTK");
    expect(result).not.toContain("Token Optimization");
  });
});
