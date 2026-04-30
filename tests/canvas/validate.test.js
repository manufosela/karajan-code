import { describe, expect, it } from "vitest";
import { validateShellTest, validateAcceptanceTests, validateCanvas } from "../../src/canvas/validate.js";

describe("validateShellTest", () => {
  it("passes a trivial shell command", () => {
    expect(validateShellTest("true").ok).toBe(true);
    expect(validateShellTest("echo hi").ok).toBe(true);
  });

  it("rejects empty / whitespace input", () => {
    expect(validateShellTest("").ok).toBe(false);
    expect(validateShellTest("   ").ok).toBe(false);
  });

  it("rejects shell syntax errors (unbalanced quote)", () => {
    const r = validateShellTest("echo 'unclosed");
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("shell-syntax");
  });

  it("rejects shell syntax errors (unexpected token)", () => {
    const r = validateShellTest("if then fi");
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("shell-syntax");
  });

  it("passes a valid jq query", () => {
    expect(validateShellTest("jq -e '.x' f.json").ok).toBe(true);
    expect(validateShellTest("cat f.json | jq '.foo[]'").ok).toBe(true);
  });

  it("REJECTS the literal 2026-04-29 incident jq (length as $n | .field)", () => {
    // The exact bug pattern from FASE 2: as-binding misuse where the
    // tail of the pipeline is the array, not the root, so .filesOver300LOC
    // is applied to an array and jq raises 'Cannot index array with string'.
    const cmd = `jq -e '[.files[] | select(.loc > 300)] | length as $n | .filesOver300LOC == $n' f.json`;
    const r = validateShellTest(cmd);
    expect(r.ok, `should have been rejected; got: ${JSON.stringify(r)}`).toBe(false);
    expect(r.kind).toBe("jq-syntax");
  });

  it("rejects an obviously malformed jq query (parse error)", () => {
    const r = validateShellTest("jq -e '.[ .' f.json");
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("jq-syntax");
  });
});

describe("validateAcceptanceTests", () => {
  it("returns empty when every test parses", () => {
    const issues = validateAcceptanceTests({
      operations: [{ title: "X", acceptance: [{ type: "shell", content: "true" }, { type: "shell", content: "echo hi" }] }],
    });
    expect(issues).toEqual([]);
  });

  it("flags one issue per broken test, with operation/test pointers", () => {
    const issues = validateAcceptanceTests({
      operations: [
        { title: "Op A", acceptance: [
          { type: "shell", content: "true" },
          { type: "shell", content: "echo 'unclosed" },
        ] },
        { title: "Op B", acceptance: [
          { type: "shell", content: "jq -e '.[ .' f.json" },
        ] },
      ],
    });
    expect(issues).toHaveLength(2);
    expect(issues[0].operationIndex).toBe(0);
    expect(issues[0].testIndex).toBe(1);
    expect(issues[1].operationIndex).toBe(1);
    expect(issues[1].testIndex).toBe(0);
  });

  it("flags gherkin without Given+Then as incomplete", () => {
    const issues = validateAcceptanceTests({
      operations: [{ title: "X", acceptance: [{ type: "gherkin", content: "When I do something" }] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("gherkin-incomplete");
  });

  it("accepts well-formed gherkin", () => {
    const issues = validateAcceptanceTests({
      operations: [{ title: "X", acceptance: [{ type: "gherkin", content: "Given X\nWhen Y\nThen Z" }] }],
    });
    expect(issues).toEqual([]);
  });
});

describe("validateCanvas (top-level)", () => {
  it("returns valid for a well-formed canvas", () => {
    const r = validateCanvas({
      title: "X",
      requirements: { problem: "do X" },
      approach: "y",
      structure: {},
      operations: [{ title: "S", acceptance: [{ type: "shell", content: "true" }] }],
    });
    expect(r.valid).toBe(true);
  });

  it("returns schema issues on bad input", () => {
    const r = validateCanvas({ title: "" });
    expect(r.valid).toBe(false);
    expect(r.schemaIssues).toBeDefined();
    expect(r.schemaIssues.length).toBeGreaterThan(0);
  });

  it("returns testIssues on broken acceptance", () => {
    const r = validateCanvas({
      title: "X",
      requirements: { problem: "do X" },
      approach: "y",
      structure: {},
      operations: [{ title: "S", acceptance: [{ type: "shell", content: "echo 'broken" }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.testIssues).toBeDefined();
    expect(r.testIssues[0].kind).toBe("shell-syntax");
  });
});
