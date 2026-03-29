import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadProductContext } from "../src/orchestrator.js";
import { buildCoderPrompt } from "../src/prompts/coder.js";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";
import { buildHuReviewerPrompt } from "../src/prompts/hu-reviewer.js";
import { buildArchitectPrompt } from "../src/prompts/architect.js";
import { buildPlannerPrompt } from "../src/prompts/planner.js";

describe("loadProductContext", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-ctx-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no context file exists", async () => {
    const result = await loadProductContext(tmpDir);
    expect(result.content).toBeNull();
    expect(result.source).toBeNull();
  });

  it("loads .karajan/context.md when it exists", async () => {
    const karajanDir = path.join(tmpDir, ".karajan");
    await fs.mkdir(karajanDir, { recursive: true });
    await fs.writeFile(path.join(karajanDir, "context.md"), "# Product Vision\nWe build dental software.");

    const result = await loadProductContext(tmpDir);
    expect(result.content).toBe("# Product Vision\nWe build dental software.");
    expect(result.source).toBe(path.join(karajanDir, "context.md"));
  });

  it("loads product-vision.md as fallback", async () => {
    await fs.writeFile(path.join(tmpDir, "product-vision.md"), "Vision fallback content");

    const result = await loadProductContext(tmpDir);
    expect(result.content).toBe("Vision fallback content");
    expect(result.source).toBe(path.join(tmpDir, "product-vision.md"));
  });

  it("prefers .karajan/context.md over product-vision.md", async () => {
    const karajanDir = path.join(tmpDir, ".karajan");
    await fs.mkdir(karajanDir, { recursive: true });
    await fs.writeFile(path.join(karajanDir, "context.md"), "Priority 1");
    await fs.writeFile(path.join(tmpDir, "product-vision.md"), "Priority 2");

    const result = await loadProductContext(tmpDir);
    expect(result.content).toBe("Priority 1");
  });

  it("uses process.cwd() when projectDir is null", async () => {
    const result = await loadProductContext(null);
    // Should not throw, just return content or null
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("source");
  });
});

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
