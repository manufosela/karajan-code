import { describe, expect, it } from "vitest";
import { buildCoderPrompt } from "../src/prompts/coder.js";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";
import { buildPlannerPrompt } from "../src/prompts/planner.js";

describe("productContext injection into prompts", () => {
  const productContext = "We build dental treatment planning software for orthodontists.";

  it("buildCoderPrompt includes productContext when provided", async () => {
    const result = await buildCoderPrompt({ task: "Add login", productContext });
    expect(result).toContain("## Product Context");
    expect(result).toContain(productContext);
  });

  it("buildCoderPrompt omits productContext when null", async () => {
    const result = await buildCoderPrompt({ task: "Add login", productContext: null });
    expect(result).not.toContain("## Product Context");
  });

  it("buildCoderPrompt anchors scope against scaffolding derailment (KJC-BUG-0167)", async () => {
    const result = await buildCoderPrompt({ task: "Add login" });
    expect(result).toContain("EXISTING project");
    expect(result).toMatch(/NEVER scaffold, bootstrap or initialize/);
    expect(result).toMatch(/never create git worktrees/);
  });

  it("buildCoderPrompt omits productContext by default", async () => {
    const result = await buildCoderPrompt({ task: "Add login" });
    expect(result).not.toContain("## Product Context");
  });

  it("buildReviewerPrompt includes productContext when provided", async () => {
    const result = await buildReviewerPrompt({
      task: "Add login",
      diff: "some diff",
      reviewRules: "rules",
      mode: "standard",
      productContext
    });
    expect(result).toContain("## Product Context");
    expect(result).toContain(productContext);
  });

  it("buildReviewerPrompt omits productContext when null", async () => {
    const result = await buildReviewerPrompt({
      task: "Add login",
      diff: "some diff",
      reviewRules: "rules",
      mode: "standard"
    });
    expect(result).not.toContain("## Product Context");
  });

  it("buildPlannerPrompt includes productContext when provided", async () => {
    const result = buildPlannerPrompt({
      task: "Implement caching",
      context: null,
      architectContext: null,
      productContext
    });
    expect(result).toContain("## Product Context");
    expect(result).toContain(productContext);
  });

  it("buildPlannerPrompt omits productContext when null", async () => {
    const result = buildPlannerPrompt({
      task: "Implement caching",
      context: null,
      architectContext: null
    });
    expect(result).not.toContain("## Product Context");
  });
});
