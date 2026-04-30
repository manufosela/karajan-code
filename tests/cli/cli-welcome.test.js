import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { printWelcomeScreen } from "../src/utils/welcome.js";

describe("printWelcomeScreen", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("prints the version number", () => {
    printWelcomeScreen({ version: "1.2.3" });
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("1.2.3");
  });

  it("prints quick start commands", () => {
    printWelcomeScreen({ version: "1.0.0" });
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("kj run");
    expect(output).toContain("kj init");
    expect(output).toContain("kj doctor");
  });

  it("hints at --help", () => {
    printWelcomeScreen({ version: "1.0.0" });
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("--help");
  });

  it("shows configured coder and reviewer when config provided", () => {
    const config = {
      coder: "claude",
      reviewer: "codex",
      roles: {
        coder: { provider: "gemini" },
        reviewer: { provider: "codex" },
      },
    };
    printWelcomeScreen({ version: "1.0.0", config });
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("gemini");
    expect(output).toContain("codex");
  });

  it("falls back to top-level coder/reviewer when roles not set", () => {
    const config = {
      coder: "aider",
      reviewer: "claude",
      roles: {
        coder: { provider: null },
        reviewer: { provider: null },
      },
    };
    printWelcomeScreen({ version: "1.0.0", config });
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("aider");
    expect(output).toContain("claude");
  });

  it("works without config (no crash)", () => {
    expect(() => printWelcomeScreen({ version: "1.0.0" })).not.toThrow();
  });

  it("works with only version provided (no config)", () => {
    expect(() => printWelcomeScreen({ version: "1.0.0" })).not.toThrow();
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("1.0.0");
  });
});
