// KJC-BUG-0076 — guard against CWE-915 (prototype pollution) in
// setDotPath. The function is invoked by runChecks() when a degradable
// check returns a remediation. Remediation outputs are LLM-generated
// today, so a malformed dot-path like `__proto__.x` would mutate
// Object.prototype globally. The guard refuses the whole write.
import { describe, expect, it, afterEach } from "vitest";
import { __pollutionInternals } from "../../src/checks/runner.js";

const { setDotPath } = __pollutionInternals;

describe("checks/runner setDotPath prototype pollution guard", () => {
  afterEach(() => {
    delete Object.prototype.polluted;
    delete Object.prototype.viaConstructor;
    delete Object.prototype.viaPrototype;
  });

  it("refuses __proto__ segments", () => {
    const overrides = {};
    setDotPath(overrides, "__proto__.polluted", true);
    expect(({}).polluted).toBeUndefined();
  });

  it("refuses constructor.prototype segments", () => {
    const overrides = {};
    setDotPath(overrides, "constructor.prototype.viaConstructor", true);
    expect(({}).viaConstructor).toBeUndefined();
  });

  it("refuses prototype segments anywhere in the path", () => {
    const overrides = {};
    setDotPath(overrides, "git.prototype.viaPrototype", true);
    expect(({}).viaPrototype).toBeUndefined();
    expect(overrides.git).toBeUndefined();
  });

  it("still writes safe dot-paths (regression: git.auto_pr=false)", () => {
    const overrides = {};
    setDotPath(overrides, "git.auto_pr", false);
    expect(overrides.git.auto_pr).toBe(false);
  });
});
