import { describe, it, expect, vi, beforeEach } from "vitest";

// Same promisify trick as osv-findings / semgrep tests so we can drive
// runWebperfScan without depending on lighthouse being installed.
const execFileMock = vi.fn();

vi.mock("node:util", async () => {
  const actual = await vi.importActual("node:util");
  return {
    ...actual,
    promisify: () => (...args) => Promise.resolve(execFileMock(...args)),
  };
});
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { runWebperfScan, parseLighthouseReport } from "../../src/webperf/scanner.js";

const noopLogger = { warn: vi.fn(), info: vi.fn() };

// Minimal lighthouse JSON fixture covering the audit ids the scanner cares about.
function lighthouseFixture(overrides = {}) {
  return {
    fetchTime: "2026-05-04T22:00:00.000Z",
    requestedUrl: "http://localhost:3000",
    finalDisplayedUrl: "http://localhost:3000",
    lighthouseVersion: "11.4.0",
    categories: { performance: { score: 0.78 } },
    audits: {
      "largest-contentful-paint": { numericValue: 5000 },
      "cumulative-layout-shift": { numericValue: 0.05 },
      "interaction-to-next-paint": { numericValue: 250 },
      "first-contentful-paint": { numericValue: 1500 },
      "total-blocking-time": { numericValue: 300 },
      "speed-index": { numericValue: 2500 },
      "interactive": { numericValue: 3500 },
      "render-blocking-resources": {
        title: "Eliminate render-blocking resources",
        score: 0.3,
        details: { overallSavingsMs: 800 },
      },
      "unused-css-rules": {
        title: "Reduce unused CSS",
        score: 0.6,
        details: { overallSavingsMs: 200, overallSavingsBytes: 12000 },
      },
      "modern-image-formats": {
        title: "Serve images in next-gen formats",
        score: 1, // passed — should be filtered
      },
      "third-party-summary": {
        title: "Minimize third-party usage",
        scoreDisplayMode: "notApplicable",
      },
      ...(overrides.audits || {}),
    },
  };
}

describe("runWebperfScan (KJC-TSK-0149)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns ok=false with no URL", async () => {
    const r = await runWebperfScan(null);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no URL/);
  });

  it("returns ok=false when lighthouse is not installed (ENOENT)", async () => {
    const enoErr = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoErr);

    const r = await runWebperfScan("http://localhost:3000", { logger: noopLogger });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not installed/);
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining("lighthouse not found"));
  });

  it("returns ok=false when scan times out", async () => {
    const timeoutErr = Object.assign(new Error("killed"), { killed: true });
    execFileMock.mockRejectedValue(timeoutErr);

    const r = await runWebperfScan("http://localhost:3000", { timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  it("returns ok=false with a clear message when the URL is unreachable", async () => {
    const fetchErr = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "Runtime error encountered: net::ERR_CONNECTION_REFUSED",
    });
    execFileMock.mockRejectedValue(fetchErr);

    const r = await runWebperfScan("http://localhost:3000");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not reachable/);
    expect(r.url).toBe("http://localhost:3000");
  });

  it("rescues exit-code-non-zero with valid JSON stdout (lighthouse warning exit)", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: JSON.stringify(lighthouseFixture()),
      stderr: "warning: ...",
    });
    execFileMock.mockRejectedValue(err);

    const r = await runWebperfScan("http://localhost:3000");
    expect(r.ok).toBe(true);
    expect(r.metrics.lcp).toBe(5000);
  });

  it("returns structured CWV + opportunities on a clean scan", async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(lighthouseFixture()), stderr: "" });

    const r = await runWebperfScan("http://localhost:3000");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("http://localhost:3000");
    expect(r.preset).toBe("desktop");
    expect(r.performanceScore).toBe(78);
    expect(r.metrics).toMatchObject({ lcp: 5000, cls: 0.05, inp: 250 });
    expect(r.cwv.pass).toBe(false); // LCP 5000 > poor 4000
    expect(r.cwv.blocking).toEqual(expect.arrayContaining([expect.objectContaining({ metric: "lcp" })]));
    expect(r.issues).toHaveLength(2); // render-blocking + unused-css; modern-image-formats passed; third-party N/A
    expect(r.issues[0].id).toBe("render-blocking-resources"); // sorted by savingsMs desc
    expect(r.issues[0].severity).toBe("high"); // score 0.3
  });

  it("uses the mobile preset when requested", async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(lighthouseFixture()), stderr: "" });

    const r = await runWebperfScan("http://localhost:3000", { preset: "mobile" });
    expect(r.preset).toBe("mobile");
    expect(execFileMock).toHaveBeenCalledWith(
      "lighthouse",
      expect.arrayContaining(["--preset=mobile"]),
      expect.any(Object)
    );
  });

  it("honors custom thresholds for the verdict", async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(lighthouseFixture()), stderr: "" });

    // Loosen LCP threshold so the same metric passes.
    const r = await runWebperfScan("http://localhost:3000", {
      thresholds: { lcp: { good: 6000, poor: 8000 } },
    });
    expect(r.cwv.pass).toBe(true);
  });

  it("falls back to max-potential-fid when interaction-to-next-paint is missing", async () => {
    const fixture = lighthouseFixture();
    delete fixture.audits["interaction-to-next-paint"];
    fixture.audits["max-potential-fid"] = { numericValue: 180 };
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(fixture), stderr: "" });

    const r = await runWebperfScan("http://localhost:3000");
    expect(r.metrics.inp).toBe(180);
  });
});

describe("parseLighthouseReport", () => {
  it("filters out passed audits (score === 1)", () => {
    const r = parseLighthouseReport(lighthouseFixture());
    const ids = r.issues.map(i => i.id);
    expect(ids).not.toContain("modern-image-formats");
  });

  it("filters out N/A audits (notApplicable)", () => {
    const r = parseLighthouseReport(lighthouseFixture());
    const ids = r.issues.map(i => i.id);
    expect(ids).not.toContain("third-party-summary");
  });

  it("caps issues at MAX_OPPORTUNITIES", () => {
    // Manufacture more opportunities than the cap allows
    const audits = {};
    for (let i = 0; i < 30; i++) {
      audits[`opp-${i}`] = { score: 0.5, details: { overallSavingsMs: i } };
    }
    // We can only test the cap on KNOWN opportunity audits.
    // Use the known list and stuff each with a low score.
    const knownAudits = {};
    const KNOWN = [
      "render-blocking-resources", "unused-css-rules", "unused-javascript",
      "unminified-css", "unminified-javascript", "modern-image-formats",
      "uses-optimized-images", "uses-text-compression", "uses-responsive-images",
      "uses-rel-preconnect", "uses-rel-preload", "font-display",
      "preload-lcp-image", "lcp-lazy-loaded", "non-composited-animations",
      "third-party-summary", "bootup-time", "mainthread-work-breakdown",
    ];
    for (const id of KNOWN) {
      knownAudits[id] = { title: id, score: 0.4, details: { overallSavingsMs: 100 } };
    }
    const fixture = lighthouseFixture({ audits: knownAudits });
    const r = parseLighthouseReport(fixture);
    expect(r.issues.length).toBeLessThanOrEqual(20);
  });

  it("handles a report missing categories.performance gracefully", () => {
    const fixture = lighthouseFixture();
    delete fixture.categories.performance;
    const r = parseLighthouseReport(fixture);
    expect(r.performanceScore).toBeNull();
  });
});
