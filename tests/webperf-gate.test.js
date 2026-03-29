import { describe, expect, it } from "vitest";
import { evaluateCwv, mergeThresholds, CWV_THRESHOLDS } from "../src/webperf/cwv-gate.js";
import { buildWebPerfSection, formatCwvForEvent } from "../src/webperf/webperf-role-integration.js";

describe("evaluateCwv", () => {
  describe("LCP", () => {
    it("LCP 2000ms → pass (good)", () => {
      const result = evaluateCwv({ lcp: 2000 });
      expect(result.scores.lcp.rating).toBe("good");
      expect(result.pass).toBe(true);
      expect(result.blocking).toHaveLength(0);
      expect(result.advisory).toHaveLength(0);
    });

    it("LCP 3000ms → advisory (needs improvement)", () => {
      const result = evaluateCwv({ lcp: 3000 });
      expect(result.scores.lcp.rating).toBe("needs-improvement");
      expect(result.pass).toBe(true);
      expect(result.advisory).toHaveLength(1);
      expect(result.advisory[0].metric).toBe("lcp");
    });

    it("LCP 5000ms → blocking (poor)", () => {
      const result = evaluateCwv({ lcp: 5000 });
      expect(result.scores.lcp.rating).toBe("poor");
      expect(result.pass).toBe(false);
      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0].metric).toBe("lcp");
      expect(result.blocking[0].threshold).toBe(4000);
    });
  });

  describe("CLS", () => {
    it("CLS 0.05 → pass (good)", () => {
      const result = evaluateCwv({ cls: 0.05 });
      expect(result.scores.cls.rating).toBe("good");
      expect(result.pass).toBe(true);
    });

    it("CLS 0.15 → advisory (needs improvement)", () => {
      const result = evaluateCwv({ cls: 0.15 });
      expect(result.scores.cls.rating).toBe("needs-improvement");
      expect(result.pass).toBe(true);
      expect(result.advisory).toHaveLength(1);
    });

    it("CLS 0.3 → blocking (poor)", () => {
      const result = evaluateCwv({ cls: 0.3 });
      expect(result.scores.cls.rating).toBe("poor");
      expect(result.pass).toBe(false);
      expect(result.blocking).toHaveLength(1);
    });
  });

  describe("INP", () => {
    it("INP 100ms → pass (good)", () => {
      const result = evaluateCwv({ inp: 100 });
      expect(result.scores.inp.rating).toBe("good");
      expect(result.pass).toBe(true);
    });

    it("INP 300ms → advisory (needs improvement)", () => {
      const result = evaluateCwv({ inp: 300 });
      expect(result.scores.inp.rating).toBe("needs-improvement");
      expect(result.pass).toBe(true);
      expect(result.advisory).toHaveLength(1);
    });

    it("INP 600ms → blocking (poor)", () => {
      const result = evaluateCwv({ inp: 600 });
      expect(result.scores.inp.rating).toBe("poor");
      expect(result.pass).toBe(false);
      expect(result.blocking).toHaveLength(1);
    });
  });

  describe("combined metrics", () => {
    it("all good → pass: true, no blocking", () => {
      const result = evaluateCwv({ lcp: 2000, cls: 0.05, inp: 100 });
      expect(result.pass).toBe(true);
      expect(result.blocking).toHaveLength(0);
      expect(result.advisory).toHaveLength(0);
      expect(Object.keys(result.scores)).toHaveLength(3);
    });

    it("mixed results → pass depends on whether any is poor", () => {
      // LCP good, CLS needs-improvement, INP poor → fail
      const fail = evaluateCwv({ lcp: 2000, cls: 0.15, inp: 600 });
      expect(fail.pass).toBe(false);
      expect(fail.blocking).toHaveLength(1);
      expect(fail.advisory).toHaveLength(1);

      // LCP good, CLS needs-improvement, INP good → pass (advisory only)
      const pass = evaluateCwv({ lcp: 2000, cls: 0.15, inp: 100 });
      expect(pass.pass).toBe(true);
      expect(pass.blocking).toHaveLength(0);
      expect(pass.advisory).toHaveLength(1);
    });
  });

  describe("custom thresholds", () => {
    it("custom thresholds override defaults", () => {
      // With default thresholds LCP 3000 is needs-improvement
      const defaultResult = evaluateCwv({ lcp: 3000 });
      expect(defaultResult.scores.lcp.rating).toBe("needs-improvement");

      // With stricter custom threshold, LCP 3000 is poor
      const strictResult = evaluateCwv({ lcp: 3000 }, { lcp: { good: 1000, poor: 2500 } });
      expect(strictResult.scores.lcp.rating).toBe("poor");
      expect(strictResult.pass).toBe(false);
    });
  });

  describe("boundary values", () => {
    it("value exactly at good threshold is good", () => {
      const result = evaluateCwv({ lcp: 2500 });
      expect(result.scores.lcp.rating).toBe("good");
    });

    it("value exactly at poor threshold is poor", () => {
      const result = evaluateCwv({ lcp: 4000 });
      expect(result.scores.lcp.rating).toBe("poor");
    });
  });
});

describe("mergeThresholds", () => {
  it("returns defaults when no custom provided", () => {
    const result = mergeThresholds(CWV_THRESHOLDS, undefined);
    expect(result.lcp.good).toBe(2500);
    expect(result.cls.good).toBe(0.1);
    expect(result.inp.good).toBe(200);
  });

  it("partial override works — only overrides specified fields", () => {
    const custom = { lcp: { good: 2000 } };
    const result = mergeThresholds(CWV_THRESHOLDS, custom);
    // Overridden
    expect(result.lcp.good).toBe(2000);
    // Kept from defaults
    expect(result.lcp.poor).toBe(4000);
    expect(result.cls.good).toBe(0.1);
    expect(result.inp.good).toBe(200);
  });

  it("full override for one metric", () => {
    const custom = { cls: { good: 0.05, poor: 0.15 } };
    const result = mergeThresholds(CWV_THRESHOLDS, custom);
    expect(result.cls.good).toBe(0.05);
    expect(result.cls.poor).toBe(0.15);
    expect(result.lcp.good).toBe(2500);
  });
});

describe("buildWebPerfSection", () => {
  it("builds readable section for passing result", () => {
    const cwv = evaluateCwv({ lcp: 2000, cls: 0.05, inp: 100 });
    const section = buildWebPerfSection(cwv);
    expect(section).toContain("PASSED");
    expect(section).toContain("LCP");
    expect(section).toContain("2000ms");
    expect(section).not.toContain("Blocking");
  });

  it("builds readable section for failing result", () => {
    const cwv = evaluateCwv({ lcp: 5000, cls: 0.3, inp: 100 });
    const section = buildWebPerfSection(cwv);
    expect(section).toContain("FAILED");
    expect(section).toContain("Blocking");
  });
});

describe("formatCwvForEvent", () => {
  it("formats result for event payload", () => {
    const cwv = evaluateCwv({ lcp: 2000, cls: 0.15, inp: 600 });
    const event = formatCwvForEvent(cwv);
    expect(event.type).toBe("webperf-cwv");
    expect(event.pass).toBe(false);
    expect(event.blockingCount).toBe(1);
    expect(event.advisoryCount).toBe(1);
    expect(event.metrics.lcp.rating).toBe("good");
  });
});
