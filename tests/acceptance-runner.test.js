import { describe, it, expect } from "vitest";
import { runAcceptanceTests, buildDiagnosticPrompt } from "../src/hu/acceptance-runner.js";

describe("runAcceptanceTests", () => {
  it("passes when all commands succeed", async () => {
    const result = await runAcceptanceTests(["echo PASS", "true"], "/tmp");
    expect(result.allPassed).toBe(true);
    expect(result.results.length).toBe(2);
    expect(result.diagnostics).toBeNull();
  });

  it("fails when any command fails", async () => {
    const result = await runAcceptanceTests(["echo PASS", "false", "echo PASS"], "/tmp");
    expect(result.allPassed).toBe(false);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[2].passed).toBe(true);
    expect(result.diagnostics).toContain("FAIL");
  });

  it("returns no-tests summary when empty", async () => {
    const result = await runAcceptanceTests([], "/tmp");
    expect(result.allPassed).toBe(false);
    expect(result.summary).toContain("No acceptance tests");
  });

  it("captures output for diagnostics", async () => {
    const result = await runAcceptanceTests(["echo 'missing package' >&2; exit 1"], "/tmp");
    expect(result.allPassed).toBe(false);
    expect(result.diagnostics).toContain("missing package");
  });
});

describe("buildDiagnosticPrompt", () => {
  it("builds actionable prompt from failures", () => {
    const failed = [
      { cmd: "npm test", exitCode: 1, output: "Error: vitest not found\n  at require" },
      { cmd: "test -f .env", exitCode: 1, output: "" }
    ];
    const prompt = buildDiagnosticPrompt(failed);
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("vitest not found");
    expect(prompt).toContain("test -f .env");
    expect(prompt).toContain("Fix ALL");
  });

  it("returns empty for no failures", () => {
    expect(buildDiagnosticPrompt([])).toBe("");
  });
});
