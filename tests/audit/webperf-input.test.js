import { describe, it, expect } from "vitest";
import { collectWebPerfInput, formatCwvVerdict } from "../../src/audit/webperf-input.js";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

// WebPerf input collector + prompt integration — KJC-TSK-0360.

describe("collectWebPerfInput (KJC-TSK-0360)", () => {
  it("returns static-hints mode for an unknown stack (frontend default)", () => {
    const r = collectWebPerfInput(null, {});
    expect(r.available).toBe(true);
    expect(r.mode).toBe("static-hints");
  });

  it("returns static-hints for a frontend project", () => {
    const r = collectWebPerfInput({ isFrontend: true, isBackend: false, isFullstack: false }, {});
    expect(r.mode).toBe("static-hints");
  });

  it("returns static-hints for a fullstack project", () => {
    const r = collectWebPerfInput({ isFrontend: true, isBackend: true, isFullstack: true }, {});
    expect(r.mode).toBe("static-hints");
  });

  it("returns available=false for a backend-only project (no frontend perf signal)", () => {
    const r = collectWebPerfInput({ isFrontend: false, isBackend: true, isFullstack: false }, {});
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/backend-only/);
  });

  it("surfaces a CWV verdict from config.webperf.lastResult when present", () => {
    const r = collectWebPerfInput(
      { isFrontend: true, isBackend: false, isFullstack: false },
      {
        webperf: {
          url: "https://example.com",
          lastResult: {
            url: "https://example.com",
            capturedAt: "2026-05-04T20:00:00Z",
            metrics: { lcp: 5000, cls: 0.05, inp: 250 },
          },
        },
      }
    );
    expect(r.mode).toBe("cwv-result");
    expect(r.url).toBe("https://example.com");
    expect(r.cwv.pass).toBe(false); // LCP 5000 > 4000 (poor)
    expect(r.cwv.blocking).toHaveLength(1);
    expect(r.cwv.blocking[0].metric).toBe("lcp");
    expect(r.cwv.advisory).toHaveLength(1); // INP 250 between good=200 and poor=500
    expect(r.cwv.advisory[0].metric).toBe("inp");
  });

  it("uses custom thresholds from lastResult when supplied", () => {
    const r = collectWebPerfInput(null, {
      webperf: {
        lastResult: {
          metrics: { lcp: 1500 },
          thresholds: { lcp: { good: 1000, poor: 2000 } },
        },
      },
    });
    expect(r.cwv.scores.lcp.rating).toBe("needs-improvement");
  });

  it("CWV-result mode beats stack heuristics (works even on backend-only)", () => {
    // Edge case: a backend-only project that somehow has a previous CWV
    // result attached. Surfacing the result is more useful than dropping it.
    const r = collectWebPerfInput(
      { isFrontend: false, isBackend: true, isFullstack: false },
      { webperf: { lastResult: { metrics: { lcp: 1000 } } } }
    );
    expect(r.available).toBe(true);
    expect(r.mode).toBe("cwv-result");
  });
});

describe("formatCwvVerdict", () => {
  it("returns null when input is not in cwv-result mode", () => {
    expect(formatCwvVerdict(null)).toBeNull();
    expect(formatCwvVerdict({ mode: "static-hints" })).toBeNull();
  });

  it("renders verdict + scores + blocking + advisory", () => {
    const text = formatCwvVerdict({
      mode: "cwv-result",
      url: "https://example.com",
      capturedAt: "2026-05-04T20:00:00Z",
      cwv: {
        pass: false,
        scores: { lcp: { value: 5000, rating: "poor" }, cls: { value: 0.05, rating: "good" } },
        blocking: [{ metric: "lcp", value: 5000, threshold: 4000, rating: "poor" }],
        advisory: [],
      },
    });
    expect(text).toContain("Target URL: https://example.com");
    expect(text).toContain("Verdict: FAIL");
    expect(text).toContain("LCP: 5000 (poor)");
    expect(text).toContain("CLS: 0.05 (good)");
    expect(text).toContain("LCP 5000 > 4000");
  });
});

describe("buildAuditPrompt — WebPerf section integration", () => {
  it("omits the section when webperf is null or unavailable", () => {
    const a = buildAuditPrompt({ task: "audit", webperf: null });
    const b = buildAuditPrompt({ task: "audit", webperf: { available: false, reason: "backend-only" } });
    expect(a).not.toContain("## WebPerf");
    expect(b).not.toContain("## WebPerf");
  });

  it("renders static frontend-perf hints for a frontend project without live measurement", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      webperf: { available: true, mode: "static-hints" },
    });
    expect(prompt).toContain("## WebPerf — Frontend Performance");
    expect(prompt).toContain("No live CWV measurement was provided");
    expect(prompt).toContain("Render-blocking");
    expect(prompt).toContain("`<img>` without `loading=\"lazy\"`");
    expect(prompt).toContain("`font-display: swap`");
  });

  it("renders the CWV verdict block when a measurement is provided", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      webperf: {
        available: true,
        mode: "cwv-result",
        url: "https://example.com",
        cwv: {
          pass: false,
          scores: { lcp: { value: 5000, rating: "poor" } },
          blocking: [{ metric: "lcp", value: 5000, threshold: 4000, rating: "poor" }],
          advisory: [],
        },
      },
    });
    expect(prompt).toContain("Live Core Web Vitals measurement available");
    expect(prompt).toContain("Verdict: FAIL");
    expect(prompt).toContain("LCP: 5000 (poor)");
  });
});
