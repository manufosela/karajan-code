import { describe, it, expect } from "vitest";
import { buildAuditPrompt, AUDIT_DIMENSIONS, parseAuditOutput } from "../../src/prompts/audit.js";

// Accessibility dimension — KJC-TSK-0359.
// Auto-active by default; auto-suppressed when stack is provably backend
// only; always honoured when the user explicitly opts in via --dimensions.

describe("AUDIT_DIMENSIONS includes accessibility", () => {
  it("exposes accessibility as a first-class dimension", () => {
    expect(AUDIT_DIMENSIONS).toContain("accessibility");
  });
});

describe("buildAuditPrompt — Accessibility section auto-activation (KJC-TSK-0359)", () => {
  it("includes the section by default when no dimension filter is set", () => {
    const prompt = buildAuditPrompt({ task: "audit" });
    expect(prompt).toContain("## Accessibility Analysis (WCAG 2.x)");
    expect(prompt).toContain("Missing alt text on <img> tags");
    expect(prompt).toContain("Form inputs without associated <label> or aria-label");
  });

  it("includes the section for a known frontend project (Astro)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["astro"], language: "javascript", isFrontend: true, isBackend: false, isFullstack: false },
    });
    expect(prompt).toContain("## Accessibility Analysis");
  });

  it("includes the section for a fullstack project (Next.js)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["next"], language: "typescript", isFrontend: true, isBackend: true, isFullstack: true },
    });
    expect(prompt).toContain("## Accessibility Analysis");
  });

  it("OMITS the section by default for a known backend-only project (Express)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["express"], language: "javascript", isFrontend: false, isBackend: true, isFullstack: false },
    });
    expect(prompt).not.toContain("## Accessibility Analysis");
  });

  it("INCLUDES the section on a backend project when explicitly requested via dimensions", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      dimensions: ["accessibility"],
      stack: { frameworks: ["express"], language: "javascript", isFrontend: false, isBackend: true, isFullstack: false },
    });
    expect(prompt).toContain("## Accessibility Analysis");
  });

  it("respects an explicit dimension list that omits accessibility", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      dimensions: ["security", "testing"],
    });
    expect(prompt).not.toContain("## Accessibility Analysis");
    expect(prompt).toContain("## Security Analysis");
    expect(prompt).toContain("## Testing Analysis");
  });

  it("includes accessibility in the JSON schema schema example so the LLM populates it", () => {
    const prompt = buildAuditPrompt({ task: "audit" });
    // Schema must list every dimension the prompt will accept back.
    for (const d of AUDIT_DIMENSIONS) {
      expect(prompt).toContain(`"${d}":{"score":"A|B|C|D|F","findings":[]}`);
    }
  });
});

describe("parseAuditOutput accepts accessibility findings", () => {
  it("surfaces accessibility findings the LLM returns", () => {
    const raw = JSON.stringify({
      ok: true,
      result: {
        summary: { overallHealth: "fair" },
        dimensions: {
          accessibility: {
            score: "C",
            findings: [
              { severity: "high", file: "src/Hero.astro", line: 42, rule: "WCAG-1.1.1", description: "Image missing alt", recommendation: "Add alt text or alt=\"\"" },
            ],
          },
        },
      },
    });
    const parsed = parseAuditOutput(raw);
    expect(parsed.dimensions.accessibility.score).toBe("C");
    expect(parsed.dimensions.accessibility.findings).toHaveLength(1);
    expect(parsed.dimensions.accessibility.findings[0].rule).toBe("WCAG-1.1.1");
    expect(parsed.summary.high).toBe(1);
  });
});
