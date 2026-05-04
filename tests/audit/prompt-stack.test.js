import { describe, it, expect } from "vitest";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

// Stack-aware prompt assembly — KJC-TSK-0358.
// The auditor LLM should be told what kind of project it's looking at so it
// filters out irrelevant heuristics (no N+1 in static Astro sites; no
// bundle-size in Express APIs). detectProjectStack itself is exercised by
// tests/lean-audit.test.js and tests/utils/stack-detect.test.js.

describe("buildAuditPrompt — Project Stack section (KJC-TSK-0358)", () => {
  it("omits the stack section when no stack data is provided", () => {
    const prompt = buildAuditPrompt({ task: "audit" });
    expect(prompt).not.toContain("## Project Stack");
  });

  it("omits the stack section when stack object is empty (defensive)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: [], language: null, isFrontend: false, isBackend: false, isFullstack: false },
    });
    expect(prompt).not.toContain("## Project Stack");
  });

  it("renders the stack section for a frontend project (Astro + Lit)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["astro", "lit"], language: "javascript", isFrontend: true, isBackend: false, isFullstack: false },
    });
    expect(prompt).toContain("## Project Stack");
    expect(prompt).toContain("Language: javascript");
    expect(prompt).toContain("Frameworks: astro, lit");
    expect(prompt).toContain("Tier: frontend-only");
    expect(prompt).toContain("SKIP findings about N+1 queries");
    expect(prompt).toContain("Focus on bundle size, lazy loading");
  });

  it("renders the stack section for a backend project (Express + node)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["express"], language: "javascript", isFrontend: false, isBackend: true, isFullstack: false },
    });
    expect(prompt).toContain("Tier: backend-only");
    expect(prompt).toContain("SKIP findings about bundle size");
    expect(prompt).toContain("Focus on queries, sync I/O");
  });

  it("renders the stack section for a fullstack project (Next)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: ["next"], language: "typescript", isFrontend: true, isBackend: true, isFullstack: true },
    });
    expect(prompt).toContain("Tier: fullstack (frontend + backend)");
    expect(prompt).toContain("Apply BOTH backend heuristics");
  });

  it("renders the stack section when only language is known (Python, no framework)", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      stack: { frameworks: [], language: "python", isFrontend: false, isBackend: true, isFullstack: false },
    });
    expect(prompt).toContain("## Project Stack");
    expect(prompt).toContain("Language: python");
    expect(prompt).toContain("Tier: backend-only");
  });
});
