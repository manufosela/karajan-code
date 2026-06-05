import { describe, it, expect } from "vitest";
import { formatDeterministicSummary, deterministicContextHasFindings } from "../../src/audit/deterministic-summary.js";

// PR 2/2 for KJC-TSK-0503 — verifies that AI-slop findings render
// inside the deterministic summary and unlock the "Continue with LLM?"
// gate when present.

describe("formatDeterministicSummary — AI-slop block", () => {
  it("renders the block with score and category breakdown when findings exist", () => {
    const md = formatDeterministicSummary({
      aiSlop: {
        available: true,
        filesScanned: 12,
        totalLOC: 1234,
        total: 4,
        score: 60,
        byCategory: {
          "tautologic-comments": 2,
          "banner-separators": 1,
          "boilerplate-docstrings": 0,
          "magic-fallbacks": 1,
          "redundant-jsdoc": 0,
        },
        worst: [
          { path: "src/a.js", line: 3, category: "tautologic-comments", snippet: "// returns the user" },
          { path: "src/b.js", line: 9, category: "magic-fallbacks", snippet: "const x = a || null;" },
        ],
      },
    });
    expect(md).toContain("### AI-slop tells (deterministic)");
    expect(md).toContain("Files scanned: 12");
    expect(md).toContain("Score: 60/100");
    expect(md).toContain("Findings: 4");
    expect(md).toContain("tautologic-comments: 2");
    expect(md).toContain("magic-fallbacks: 1");
    expect(md).not.toContain("boilerplate-docstrings: 0");
    expect(md).toContain("src/a.js:3");
    expect(md).toContain("src/b.js:9");
  });

  it("renders a 'not available' line when the scan failed", () => {
    const md = formatDeterministicSummary({
      aiSlop: { available: false, reason: "ENOENT" },
    });
    expect(md).toContain("### AI-slop tells (deterministic)");
    expect(md).toContain("not available — ENOENT");
  });

  it("does not render any block when ctx.aiSlop is absent", () => {
    const md = formatDeterministicSummary({});
    expect(md).not.toContain("### AI-slop tells");
  });
});

describe("deterministicContextHasFindings — AI-slop signal", () => {
  it("returns true when AI-slop has at least one finding", () => {
    expect(deterministicContextHasFindings({
      aiSlop: { available: true, total: 1, score: 95, byCategory: {} },
    })).toBe(true);
  });

  it("returns false when AI-slop is clean (total=0)", () => {
    expect(deterministicContextHasFindings({
      aiSlop: { available: true, total: 0, score: 100, byCategory: {} },
    })).toBe(false);
  });

  it("returns false when AI-slop is unavailable", () => {
    expect(deterministicContextHasFindings({
      aiSlop: { available: false, reason: "x" },
    })).toBe(false);
  });
});
