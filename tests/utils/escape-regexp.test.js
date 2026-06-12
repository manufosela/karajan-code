import { describe, it, expect } from "vitest";
import { escapeRegExp } from "../../src/utils/escape-regexp.js";

// KJC-TSK-0536 — shared escape for every variable interpolated into a
// RegExp. Closes Semgrep's detect-non-literal-regexp findings.

describe("escapeRegExp", () => {
  it("escapes every regex metacharacter", () => {
    const meta = ".*+?^${}()|[]\\";
    const escaped = escapeRegExp(meta);
    expect(new RegExp(`^${escaped}$`).test(meta)).toBe(true);
  });

  it("leaves plain identifiers untouched", () => {
    expect(escapeRegExp("ClaudeBot")).toBe("ClaudeBot");
    expect(escapeRegExp("HU-001_alpha")).toBe("HU-001_alpha");
  });

  it("coerces non-string input (ports, ids)", () => {
    expect(escapeRegExp(9000)).toBe("9000");
    expect(new RegExp(`:${escapeRegExp(9000)}\\b`).test(":9000 LISTEN")).toBe(true);
  });

  it("neutralizes a pathological injected pattern", () => {
    const hostile = "(a+)+$";
    const re = new RegExp(`^${escapeRegExp(hostile)}$`);
    expect(re.test("(a+)+$")).toBe(true);
    expect(re.test("aaaa")).toBe(false);
  });
});
