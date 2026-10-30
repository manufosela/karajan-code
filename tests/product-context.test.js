import { describe, expect, it } from "vitest";
import { buildCoderPrompt } from "../src/prompts/coder.js";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";
import { buildHuReviewerPrompt } from "../src/prompts/hu-reviewer.js";
import { buildArchitectPrompt } from "../src/prompts/architect.js";
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

  it("buildHuReviewerPrompt includes productContext when provided", async () => {
    const result = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a doctor..." }],
      instructions: null,
      productContext
    });
    expect(result).toContain("## Product Context");
    expect(result).toContain(productContext);
  });

  it("buildHuReviewerPrompt omits productContext when null", async () => {
    const result = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a doctor..." }],
      instructions: null
    });
    expect(result).not.toContain("## Product Context");
  });

  it("buildArchitectPrompt includes productContext when provided", async () => {
    const result = await buildArchitectPrompt({
      task: "Design auth system",
      instructions: null,
      productContext
    });
    expect(result).toContain("## Product Context");
    expect(result).toContain(productContext);
  });

  it("buildArchitectPrompt omits productContext when null", async () => {
    const result = await buildArchitectPrompt({
      task: "Design auth system",
      instructions: null
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
