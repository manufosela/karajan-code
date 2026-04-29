import { describe, expect, it, vi } from "vitest";
import { RepairerRole } from "../../src/roles/repairer-role.js";

const makeLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn(), resetContext: vi.fn() });

describe("RepairerRole", () => {
  it("extractInput accepts a string and yields safe defaults", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    const got = r.extractInput("just a cmd");
    expect(got.failingTest).toBe("just a cmd");
    expect(got.errorOutput).toBe("");
    expect(got.huTitle).toBe("");
    expect(got.siblingTests).toEqual([]);
    expect(got.iteration).toBe(0);
  });

  it("extractInput accepts a structured object", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    const got = r.extractInput({
      failingTest: { type: "shell", content: "jq -e '.x'" },
      errorOutput: "err", huTitle: "T", huScope: "S",
      siblingTests: [{ type: "shell", content: "echo 1" }],
      iteration: 3,
    });
    expect(got.failingTest.content).toBe("jq -e '.x'");
    expect(got.iteration).toBe(3);
    expect(got.siblingTests).toHaveLength(1);
  });

  it("buildPrompt includes the failing test, error output and HU intent", async () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    const { prompt } = await r.buildPrompt({
      failingTest: { type: "shell", content: "jq -e 'BROKEN' f.json" },
      errorOutput: "Cannot index array with string \"foo\"",
      huTitle: "Add audit script",
      huScope: "Generates a JSON report classifying every test file",
      siblingTests: [],
      iteration: 3,
    });
    expect(prompt).toMatch(/jq -e 'BROKEN'/);
    expect(prompt).toMatch(/Cannot index array/);
    expect(prompt).toMatch(/Add audit script/);
    expect(prompt).toMatch(/3 iteration\(s\)/);
    // Output schema is part of the prompt, so the LLM knows the shape.
    expect(prompt).toMatch(/"verdict":"fixable"\|"unfixable"/);
  });

  it("buildPrompt lists sibling tests when present (consistency context)", async () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    const { prompt } = await r.buildPrompt({
      failingTest: { type: "shell", content: "echo bad" },
      errorOutput: "",
      huTitle: "T", huScope: "S",
      siblingTests: [
        { type: "shell", content: "echo sibling-1" },
        { type: "gherkin", content: "Given X When Y Then Z" },
      ],
      iteration: 0,
    });
    expect(prompt).toMatch(/echo sibling-1/);
    expect(prompt).toMatch(/Given X When Y Then Z/);
    expect(prompt).toMatch(/do NOT modify these/);
  });

  it("isSuccessful: fixable + complete fixed_test → true", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    expect(r.isSuccessful({
      verdict: "fixable",
      fixed_test: { type: "shell", content: "jq -e '.x == 1' f.json" },
      reason: "rewrote jq",
    })).toBe(true);
  });

  it("isSuccessful: fixable but missing fixed_test → false", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    expect(r.isSuccessful({ verdict: "fixable", fixed_test: null, reason: "x" })).toBe(false);
    expect(r.isSuccessful({ verdict: "fixable", fixed_test: { type: "shell", content: "" }, reason: "x" })).toBe(false);
  });

  it("isSuccessful: unfixable + reason → true (escalation is a valid OUTCOME, not a role failure)", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    expect(r.isSuccessful({
      verdict: "unfixable",
      fixed_test: null,
      reason: "test depends on Sonar 9000 reachable, network isolated",
    })).toBe(true);
  });

  it("isSuccessful: unfixable but no reason → false", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    expect(r.isSuccessful({ verdict: "unfixable", fixed_test: null, reason: "" })).toBe(false);
    expect(r.isSuccessful({ verdict: "unfixable", fixed_test: null })).toBe(false);
  });

  it("isSuccessful: unknown verdict → false", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    expect(r.isSuccessful({ verdict: "maybe", reason: "x" })).toBe(false);
    expect(r.isSuccessful(null)).toBe(false);
  });

  it("buildSuccessResult preserves all fields", () => {
    const r = new RepairerRole({ config: {}, logger: makeLogger() });
    const out = r.buildSuccessResult({
      verdict: "fixable",
      fixed_test: { type: "shell", content: "fixed" },
      reason: "jq as-binding misuse",
      diagnostics: ["jq -n '.x' parsed", "echo |jq -n '.x' worked"],
    }, "claude");
    expect(out.verdict).toBe("fixable");
    expect(out.fixed_test).toEqual({ type: "shell", content: "fixed" });
    expect(out.reason).toBe("jq as-binding misuse");
    expect(out.diagnostics).toHaveLength(2);
    expect(out.provider).toBe("claude");
  });
});
