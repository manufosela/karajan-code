import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn()
}));

vi.mock("../../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => "/home/user/.karajan")
}));

const { readdir, readFile, writeFile, mkdir } = await import("node:fs/promises");

describe("Domain Knowledge System — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
  });

  it("domainContext injection in coder prompt (end-to-end)", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({
      task: "Build dental treatment approval workflow",
      domainContext: "### dental-clinical\n\n#### Business Rules\nTreatment plans must be approved by lead clinician.",
      productContext: "We are building a dental platform."
    });

    // Both contexts should be present
    expect(prompt).toContain("## Product Context");
    expect(prompt).toContain("dental platform");
    expect(prompt).toContain("## Domain Context");
    expect(prompt).toContain("Treatment plans must be approved");
  });
});
