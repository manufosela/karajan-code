// KJC-TSK-0939 (MDR-C, ADR 0016): the Sentinel's rules gate as a real module,
// tested by unit. It asks `kj rules eval`; what cannot be evaluated is denied.
import { describe, it, expect, vi } from "vitest";
import { rulesGate, brokenKjFile } from "../../src/harden/sentinel/sentinel-rules.mjs";

const ROOT = "/repo";
const withRules = () => true;
const kj = (status, stdout = "", stderr = "") => vi.fn(() => ({ status, stdout, stderr }));
const gate = (run, over = {}) => rulesGate({ root: ROOT, tool: "mcp__pg__create_sprint", input: { allowLongSprint: true }, run, exists: withRules, ...over });

describe("rulesGate", () => {
  it("without .karajan/rules.yml it lets everything through and never runs kj", () => {
    const run = kj(2);
    expect(gate(run, { exists: () => false })).toEqual({ deny: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks kj rules eval with the tool, and the input on stdin (a large Write does not fit in an argument)", () => {
    const run = kj(0, '{"decision":"allow"}');
    expect(gate(run)).toEqual({ deny: false });
    expect(run).toHaveBeenCalledWith("kj", ["rules", "eval", "--tool", "mcp__pg__create_sprint", "--input", "-"],
      { cwd: ROOT, encoding: "utf8", input: '{"allowLongSprint":true}' });
  });

  it("exit 2 denies citing the rule, its MD and its message, with no escape", () => {
    const verdict = gate(kj(2, 'noise\n{"decision":"deny","rule_id":"R-0000000001","source":"CLAUDE.md","message":"Un sprint dura un día."}\n'));
    expect(verdict.deny).toBe(true);
    expect(verdict.message).toMatch(/R-0000000001 \(CLAUDE\.md\): Un sprint dura un día\./);
    expect(verdict.message).toMatch(/Sin escape/);
    expect(gate(kj(2, "not json")).message).toMatch(/sin identificar/);
  });

  it("what cannot be evaluated is denied, saying why: kj missing, or an invalid rules.yml", () => {
    const missing = gate(vi.fn(() => ({ error: new Error("ENOENT"), status: null })));
    expect(missing).toMatchObject({ deny: true });
    expect(missing.message).toMatch(/kj no es ejecutable/);
    const invalid = gate(kj(1, '{"errors":["rules[0] (bad): id must be an inventory id"]}'));
    expect(invalid.deny).toBe(true);
    expect(invalid.message).toMatch(/id must be an inventory id/);
    expect(gate(kj(1, "")).message).toMatch(/exit 1/);
  });

  it("a kj broken by its own tree only lets the breaking file be edited (KJC-BUG-0207)", () => {
    const stderr = "file:///repo/src/x.js:12\n  oops(\nSyntaxError: Unexpected token";
    const run = kj(1, "", stderr);
    expect(brokenKjFile(stderr)).toBe("/repo/src/x.js");
    expect(gate(run, { tool: "Edit", input: { file_path: "/repo/src/x.js" } })).toEqual({ deny: false });
    expect(gate(run, { tool: "Edit", input: { file_path: "/repo/src/other.js" } }).message).toMatch(/kj no arranca \(\/repo\/src\/x\.js\)/);
    expect(gate(run, { tool: "Bash", input: { command: "ls" } }).deny).toBe(true);
    // A path with blanks, as a path or as a file: URL; a stack frame is not the location line.
    expect(brokenKjFile("/my repo/src/x.js:3\nSyntaxError: x")).toBe("/my repo/src/x.js");
    expect(brokenKjFile("file:///my%20repo/src/x.mjs:3\nSyntaxError: x")).toBe("/my repo/src/x.mjs");
    expect(brokenKjFile("SyntaxError: x\n    at /a/b.js:12")).toBe("");
    expect(brokenKjFile("some other failure")).toBeNull();
    expect(brokenKjFile("ReferenceError: x is not defined")).toBe("");
  });
});
