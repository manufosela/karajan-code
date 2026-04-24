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

  // Tests-first (v2.7.5): structured entries.
  it("executes structured shell entries like plain strings", async () => {
    const result = await runAcceptanceTests(
      [{ type: "shell", content: "echo ok" }, { type: "shell", content: "true" }],
      "/tmp"
    );
    expect(result.allPassed).toBe(true);
    expect(result.pending).toBe(0);
    expect(result.results.every((r) => r.type === "shell")).toBe(true);
  });

  it("marks gherkin entries as pending (not run, not failed) until the tester translates them", async () => {
    const result = await runAcceptanceTests(
      [
        { type: "shell", content: "echo ok" },
        { type: "gherkin", content: "Given x\nWhen y\nThen z" },
      ],
      "/tmp"
    );
    // The shell entry passes, the gherkin is pending — overall gate
    // passes because all executable tests pass. The summary tells the
    // user one gherkin is waiting for Phase 3 translation.
    expect(result.allPassed).toBe(true);
    expect(result.pending).toBe(1);
    expect(result.summary).toContain("1 gherkin");
    const gherkinEntry = result.results.find((r) => r.type === "gherkin");
    expect(gherkinEntry.pending).toBe(true);
  });

  it("mixes legacy strings and structured entries seamlessly", async () => {
    const result = await runAcceptanceTests(
      ["echo legacy", { type: "shell", content: "echo structured" }],
      "/tmp"
    );
    expect(result.allPassed).toBe(true);
    expect(result.results.length).toBe(2);
  });

  it("flags malformed entries without crashing the whole gate", async () => {
    const result = await runAcceptanceTests([{ foo: "bar" }, "true"], "/tmp");
    const invalidEntry = result.results.find((r) => r.type === "invalid");
    expect(invalidEntry).toBeDefined();
    expect(invalidEntry.passed).toBe(false);
    // The valid "true" command still ran successfully.
    expect(result.results.some((r) => r.type === "shell" && r.passed)).toBe(true);
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
