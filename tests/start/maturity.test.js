import { describe, it, expect } from "vitest";
import { classifyMaturity } from "../../src/start/maturity.js";

/**
 * KJC-TSK-0568 (Onboard A) — maturity classifier.
 *
 * Pure, deterministic, no LLM. Maps a bundle of read-only signals to one
 * of new | existing | legacy, mirroring the card's acceptance criteria:
 *   - empty repo / scaffolding only        -> new
 *   - code + config + tests/CI             -> existing
 *   - code but no tests/CI, or stalled     -> legacy
 * A user-declared maturity always wins over inference.
 */
describe("classifyMaturity (KJC-TSK-0568)", () => {
  const healthy = {
    declared: null,
    hasSourceCode: true,
    scaffoldingOnly: false,
    hasTests: true,
    hasCI: true,
    commitCount: 120,
    staleDays: 5,
  };

  it("respects a user-declared maturity over the signals", () => {
    const r = classifyMaturity({ ...healthy, declared: "legacy" });
    expect(r.maturity).toBe("legacy");
    expect(r.declared).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/declared/i);
  });

  it("ignores an invalid declared value and falls back to inference", () => {
    const r = classifyMaturity({ ...healthy, declared: "ancient" });
    expect(r.maturity).toBe("existing");
    expect(r.declared).toBe(false);
  });

  it("classifies an empty repo as new", () => {
    const r = classifyMaturity({
      declared: null,
      hasSourceCode: false,
      scaffoldingOnly: false,
      hasTests: false,
      hasCI: false,
      commitCount: 0,
      staleDays: null,
    });
    expect(r.maturity).toBe("new");
  });

  it("classifies a scaffolding-only repo as new", () => {
    const r = classifyMaturity({ ...healthy, hasSourceCode: true, scaffoldingOnly: true });
    expect(r.maturity).toBe("new");
  });

  it("classifies code + tests + CI as existing", () => {
    expect(classifyMaturity(healthy).maturity).toBe("existing");
  });

  it("classifies code without tests as legacy", () => {
    expect(classifyMaturity({ ...healthy, hasTests: false }).maturity).toBe("legacy");
  });

  it("classifies code without CI as legacy", () => {
    expect(classifyMaturity({ ...healthy, hasCI: false }).maturity).toBe("legacy");
  });

  it("classifies a healthy-but-stalled repo as legacy", () => {
    const r = classifyMaturity({ ...healthy, staleDays: 540 });
    expect(r.maturity).toBe("legacy");
    expect(r.reasons.join(" ")).toMatch(/stall|old|inactiv/i);
  });

  it("recommends a deep health pass only for legacy", () => {
    expect(classifyMaturity(healthy).deepHealthRecommended).toBe(false);
    expect(classifyMaturity({ ...healthy, hasCI: false }).deepHealthRecommended).toBe(true);
    expect(classifyMaturity({ declared: null, hasSourceCode: false, scaffoldingOnly: false, hasTests: false, hasCI: false, commitCount: 0, staleDays: null }).deepHealthRecommended).toBe(false);
  });

  it("always returns at least one reason", () => {
    for (const m of [healthy, { ...healthy, hasTests: false }, { ...healthy, hasSourceCode: false }]) {
      expect(classifyMaturity(m).reasons.length).toBeGreaterThan(0);
    }
  });

  it("throws on a missing or non-object signal bundle", () => {
    expect(() => classifyMaturity(null)).toThrow(TypeError);
    expect(() => classifyMaturity("nope")).toThrow(TypeError);
  });
});
