import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "../src/prompts/planner.js";

describe("prompts/planner buildPlannerPrompt", () => {
  it("includes the task in the prompt", () => {
    const prompt = buildPlannerPrompt({ task: "Add user authentication" });
    expect(prompt).toContain("Add user authentication");
  });

  it("requests JSON output with required fields", () => {
    const prompt = buildPlannerPrompt({ task: "Refactor DB layer" });
    expect(prompt).toContain("approach");
    expect(prompt).toContain("steps");
    expect(prompt).toContain("risks");
    expect(prompt).toContain("outOfScope");
  });

  it("includes context when provided", () => {
    const prompt = buildPlannerPrompt({
      task: "Add caching",
      context: "We use Redis in production"
    });
    expect(prompt).toContain("Redis");
  });

  it("works without optional context", () => {
    const prompt = buildPlannerPrompt({ task: "Simple fix" });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("requests each step to be a single commit", () => {
    const prompt = buildPlannerPrompt({ task: "Big refactor" });
    expect(prompt.toLowerCase()).toContain("commit");
  });

  it("asks for structured JSON format", () => {
    const prompt = buildPlannerPrompt({ task: "Add feature" });
    expect(prompt).toContain("JSON");
  });

  it("includes architecture context section when architectContext is provided", () => {
    const architectContext = {
      architecture: {
        type: "layered",
        layers: ["API", "Service", "Repository"],
        patterns: ["Factory", "Observer"],
        dataModel: { entities: ["User", "Order"] },
        apiContracts: ["POST /users", "GET /orders"],
        tradeoffs: ["Simplicity over flexibility"]
      },
      summary: "Layered architecture with factory pattern"
    };
    const prompt = buildPlannerPrompt({ task: "Add feature", architectContext });
    expect(prompt).toContain("Architecture Context");
    expect(prompt).toContain("layered");
    expect(prompt).toContain("API, Service, Repository");
    expect(prompt).toContain("Factory, Observer");
    expect(prompt).toContain("User, Order");
    expect(prompt).toContain("POST /users");
    expect(prompt).toContain("Simplicity over flexibility");
    expect(prompt).toContain("Layered architecture with factory pattern");
  });

  it("omits architecture context section when architectContext is not provided", () => {
    const prompt = buildPlannerPrompt({ task: "Simple fix" });
    expect(prompt).not.toContain("Architecture Context");
  });

  it("handles partial architectContext gracefully", () => {
    const architectContext = {
      architecture: { type: "monolith", layers: [], patterns: [] },
      summary: "Simple monolith"
    };
    const prompt = buildPlannerPrompt({ task: "Fix bug", architectContext });
    expect(prompt).toContain("Architecture Context");
    expect(prompt).toContain("monolith");
    expect(prompt).toContain("Simple monolith");
    expect(prompt).not.toContain("Layers:");
    expect(prompt).not.toContain("Patterns:");
  });

  // PR F follow-up (v2.7.5): the CLI planner prompt must demand
  // spec_section + acceptance_tests structured output the same way
  // planner-role.js does in the orchestrator path. Earlier the CLI
  // path silently dropped both, leaving plan.js parsing fields the
  // LLM was never asked to produce.

  describe("acceptance_tests guidance", () => {
    it("requires acceptance_tests with structured shape on every step", () => {
      const prompt = buildPlannerPrompt({ task: "Add caching" });
      expect(prompt).toMatch(/`acceptance_tests`.*REQUIRED/);
      expect(prompt).toContain('"type": "gherkin"');
      expect(prompt).toContain('"type": "shell"');
    });

    it("forbids the placeholder npx vitest run", () => {
      const prompt = buildPlannerPrompt({ task: "Add caching" });
      expect(prompt).toMatch(/Do NOT use the placeholder.*npx vitest run/);
    });
  });

  describe("spec_section guidance — unstructured task", () => {
    it("marks spec_section as optional when task has no numbered headings", () => {
      const prompt = buildPlannerPrompt({ task: "Fix login bug — the cookie is not being cleared." });
      expect(prompt).toMatch(/`spec_section`.*optional/);
      expect(prompt).not.toMatch(/`spec_section`.*REQUIRED/);
    });
  });

  describe("spec_section guidance — structured SPEC", () => {
    const SPEC = [
      "# Tiny Math Library — SPEC",
      "## 1. Overview",
      "blah",
      "## 2. Functions",
      "### 2.1 add",
      "blah",
      "### 2.2 multiply",
      "blah",
      "## 3. Test contract",
      "blah",
    ].join("\n");

    it("escalates spec_section to REQUIRED when numbered headings are present", () => {
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toMatch(/`spec_section`.*REQUIRED/);
      expect(prompt).toContain("Detected 5 numbered SPEC heading(s)");
    });

    it("echoes the detected sections back as a checklist the LLM must pick from", () => {
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toContain('"1" — Overview');
      expect(prompt).toContain('"2" — Functions');
      expect(prompt).toContain('"2.1" — add');
      expect(prompt).toContain('"2.2" — multiply');
      expect(prompt).toContain('"3" — Test contract');
    });

    it("forbids null / omitted / paraphrased spec_section values", () => {
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toMatch(/NEVER `null`, NEVER omitted, NEVER a free-form paraphrase/);
    });
  });

  describe("reuse marker (KJC-BUG-0044 / P3)", () => {
    it("documents the reuse field in the step schema", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt).toContain('"reuse"');
    });

    it("instructs the planner to mark reuse instead of reimplementing existing functionality", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt).toMatch(/reuse.*instead of reimplementing/i);
    });

    it("provides a concrete reuse example so the rule is concrete", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt.toLowerCase()).toMatch(/versionado|versioning|hash|encryption|cache|util/);
    });

    it("clarifies that reuse and dependencies are different semantic concepts", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt).toMatch(/reuse.*(?:not|≠|different).*dependenc/i);
    });
  });

  describe("transversal dependencies (KJC-BUG-0043 / P2)", () => {
    it("instructs the planner to declare deps to ALL members of a category, not just the first", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt.toLowerCase()).toContain("transversal");
      expect(prompt).toMatch(/ALL members of (?:a |that )?category/i);
    });

    it("provides a concrete listado/summary example so the LLM cannot miss the rule", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt.toLowerCase()).toMatch(/listado|list of all|summary across|summary of all/);
    });

    it("forbids depending only on the index/first step of a category", () => {
      const prompt = buildPlannerPrompt({ task: "anything" });
      expect(prompt).toMatch(/NOT just (?:the )?(?:first|index)/i);
    });
  });

  describe("scope exclusions (KJC-BUG-0042 / P1)", () => {
    it("echoes NO incluye items as FORBIDDEN scope when task has explicit Spanish exclusions", () => {
      const SPEC = [
        "# Plan 2 — GRETA",
        "## Scope",
        "Cubre PROFILE, ASSESS, AI.",
        "",
        "NO incluye en este plan: vistas compartidas, filtros comparativos, exportación CSV.",
      ].join("\n");
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toContain("FORBIDDEN");
      expect(prompt).toContain("vistas compartidas");
      expect(prompt).toContain("filtros comparativos");
      expect(prompt).toContain("exportación CSV");
    });

    it("echoes Out of scope items when task has English exclusions", () => {
      const SPEC = [
        "# Spec",
        "Out of scope: real-time sync, mobile UI, payment integration.",
      ].join("\n");
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toContain("FORBIDDEN");
      expect(prompt).toContain("real-time sync");
      expect(prompt).toContain("mobile UI");
      expect(prompt).toContain("payment integration");
    });

    it("echoes 'Plan X handles' references as out-of-scope for current plan", () => {
      const SPEC = [
        "# Plan 2",
        "Plan 3 handles cross-tenant views and shared dashboards.",
      ].join("\n");
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toContain("FORBIDDEN");
      expect(prompt).toContain("cross-tenant views");
      expect(prompt).toContain("shared dashboards");
    });

    it("does NOT emit FORBIDDEN section when no exclusions are declared", () => {
      const prompt = buildPlannerPrompt({ task: "Add login page with email/password" });
      expect(prompt).not.toContain("FORBIDDEN");
    });

    it("instructs the planner to NEVER generate steps for FORBIDDEN items", () => {
      const SPEC = "NO incluye: foo, bar.";
      const prompt = buildPlannerPrompt({ task: SPEC });
      expect(prompt).toMatch(/Do NOT generate steps/i);
      expect(prompt).toMatch(/outOfScope/);
    });
  });
});
