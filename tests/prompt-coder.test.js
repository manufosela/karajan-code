import { describe, expect, it } from "vitest";
import { buildCoderPrompt, buildCoderPromptLayout } from "../src/prompts/coder.js";

describe("buildCoderPromptLayout (Φ1 — prefix caching)", () => {
  const baseConfig = {
    coderRules: "Always use arrow functions",
    methodology: "tdd",
    productContext: "A CLI tool",
  };

  it("keeps the stable block byte-identical across different tasks and feedback", async () => {
    const a = await buildCoderPromptLayout({ ...baseConfig, task: "Add login" });
    const b = await buildCoderPromptLayout({
      ...baseConfig,
      task: "Fix logout",
      reviewerFeedback: "Missing validation",
      sonarSummary: "2 issues",
    });

    expect(a.stable).toBe(b.stable);
    expect(a.volatile).not.toBe(b.volatile);
  });

  it("puts every per-HU section in the volatile block, after all stable content", async () => {
    const layout = await buildCoderPromptLayout({
      ...baseConfig,
      task: "Add login",
      plan: "1. do it",
      sonarSummary: "1 issue",
      reviewerFeedback: "fix this",
    });

    expect(layout.stable).toContain("Coder rules (MUST follow)");
    expect(layout.stable).toContain("Default development policy: TDD");
    expect(layout.stable).toContain("## Product Context");
    expect(layout.volatile).toContain("Task:\nAdd login");
    expect(layout.volatile).toContain("Implementation Plan");
    expect(layout.volatile).toContain("Sonar summary");
    expect(layout.volatile).toContain("YOU MUST FIX THESE");
  });

  it("preserves the legacy relative order inside the volatile block", async () => {
    const layout = await buildCoderPromptLayout({
      task: "Add login",
      plan: "1. do it",
      acceptanceTests: ["npm test"],
      sonarSummary: "1 issue",
      reviewerFeedback: "fix this",
      deferredContext: "deferred notes",
    });
    const v = layout.volatile;
    const order = [
      v.indexOf("Task:\nAdd login"),
      v.indexOf("Implementation Plan"),
      v.indexOf("Acceptance Tests"),
      v.indexOf("Sonar summary"),
      v.indexOf("YOU MUST FIX THESE"),
      v.indexOf("deferred notes"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("buildCoderPrompt renders stable prefix first, volatile tail last", async () => {
    const full = await buildCoderPrompt({ ...baseConfig, task: "Add login" });
    const layout = await buildCoderPromptLayout({ ...baseConfig, task: "Add login" });

    expect(full.startsWith(layout.stable)).toBe(true);
    expect(full.endsWith(layout.volatile)).toBe(true);
  });
});

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

    expect(result).toContain("Missing input validation on POST /users");
    expect(result).toContain("YOU MUST FIX THESE");
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
    expect(result).toContain("Tests missing for edge case");
    expect(result).toContain("YOU MUST FIX THESE");
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

  // Resilience audit followup — sesgo de stack: when the caller passes
  // a detected stack, the prompt MUST tell the coder which framework to
  // use, so it does not install vitest in a pure-Python repo.
  describe("Project Stack section (stack-aware prompt)", () => {
    it("emits 'Project Stack' + the detected language and test framework", async () => {
      const result = await buildCoderPrompt({
        task: "Add login",
        stack: { language: "python", frameworks: ["fastapi"] },
        testFramework: { hasTests: true, framework: "pytest", language: "python" },
      });
      expect(result).toContain("Project Stack");
      expect(result).toContain("Language: **python**");
      expect(result).toContain("fastapi");
      expect(result).toContain("**pytest**");
    });

    it("warns against vitest / jest / npm install when language is non-JS and no framework yet", async () => {
      const result = await buildCoderPrompt({
        task: "Add login",
        stack: { language: "python", frameworks: [] },
        testFramework: { hasTests: false },
      });
      expect(result).toMatch(/pytest for python/);
      expect(result).toMatch(/Do NOT use vitest \/ jest \/ `npm install` in a non-JS project/);
    });

    it("omits the Project Stack section when no stack is provided (back-compat)", async () => {
      const result = await buildCoderPrompt({ task: "Add login" });
      expect(result).not.toContain("Project Stack");
    });

    it("the 'install dependencies' guidance is no longer hardcoded to npm install", async () => {
      const result = await buildCoderPrompt({
        task: "Fix the bug",
        reviewerFeedback: "missing null check",
      });
      // Either it mentions the family of package managers or it doesn't
      // mention any (instead of saying just `npm install` as if every
      // project were a JS project).
      expect(result).toMatch(/pip install|cargo add|go get|package manager/);
    });
  });
});
