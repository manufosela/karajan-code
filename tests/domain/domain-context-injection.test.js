import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn()
}));

const { readdir, readFile } = await import("node:fs/promises");

describe("domainContext injection into prompt builders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("coder prompt includes domain context when provided", async () => {
    const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({
      task: "Build feature",
      domainContext: "### dental\n\nTeeth use FDI numbering."
    });

    expect(prompt).toContain("## Domain Context");
    expect(prompt).toContain("FDI numbering");
  });

  it("coder prompt omits domain context when null", async () => {
    const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({
      task: "Build feature",
      domainContext: null
    });

    expect(prompt).not.toContain("## Domain Context");
  });

  it("reviewer prompt includes domain context when provided", async () => {
    const { buildReviewerPrompt } = await import("../../src/prompts/reviewer.js");
    const prompt = await buildReviewerPrompt({
      task: "Review code",
      diff: "some diff",
      reviewRules: "be strict",
      mode: "standard",
      domainContext: "### billing\n\nInvoices need VAT."
    });

    expect(prompt).toContain("## Domain Context");
    expect(prompt).toContain("Invoices need VAT");
  });

  it("planner prompt includes domain context when provided", async () => {
    const { buildPlannerPrompt } = await import("../../src/prompts/planner.js");
    const prompt = buildPlannerPrompt({
      task: "Plan feature",
      context: "some context",
      domainContext: "### dental\n\nTreatment plans need approval."
    });

    expect(prompt).toContain("## Domain Context");
    expect(prompt).toContain("Treatment plans need approval");
  });
});
