import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentReadiness, formatAgentReadinessReport } from "../../src/audit/agent-readiness.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-audit-ar-"));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("runAgentReadiness", () => {
  it("scores 0-ish on a bare repo (no llms.txt, no docs/, no robots)", () => {
    const r = runAgentReadiness(tmp);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(40); // generous upper bound — most checks fail
    expect(r.checks).toHaveLength(7);
    expect(r.topFixes.length).toBeGreaterThan(0);
    expect(r.topFixes[0]).toHaveProperty("checkId");
    expect(r.topFixes[0]).toHaveProperty("action");
  });

  it("scores high (≥ 80) on a fully agent-ready repo", () => {
    // llms.txt with proper structure
    fs.writeFileSync(path.join(tmp, "llms.txt"), [
      "# Demo repo",
      "",
      "## Commands",
      "- [kj plan](docs/agents/SKILL.kj-plan.md)",
      "",
      "## Docs",
      "- [Architecture](docs/ARCHITECTURE.md)",
    ].join("\n"));

    // robots.txt with AI bot allowlist
    fs.writeFileSync(path.join(tmp, "robots.txt"), [
      "User-agent: GPTBot",
      "Allow: /",
      "",
      "User-agent: ClaudeBot",
      "Allow: /",
    ].join("\n"));

    // docs/ with a small file
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "ARCHITECTURE.md"), "# Architecture\n\n## Section\n\nText.");

    // docs/agents/ with README + one SKILL.md
    const agentsDir = path.join(docsDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "README.md"), "# Agents\n\n## Index");
    fs.writeFileSync(path.join(agentsDir, "SKILL.kj-plan.md"), "# kj plan\n\n## Inputs\n\nFoo.");

    const r = runAgentReadiness(tmp);
    expect(r.score, `report:\n${JSON.stringify(r, null, 2)}`).toBeGreaterThanOrEqual(80);
  });

  it("flags oversized doc pages (> 32 KB) as a budget violation", () => {
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    // 50 KB doc
    fs.writeFileSync(path.join(docsDir, "huge.md"), "# Huge\n\n## Section\n\n" + "x".repeat(50 * 1024));

    const r = runAgentReadiness(tmp);
    const budget = r.checks.find((c) => c.id === "page-token-budget");
    expect(budget.ok).toBe(false);
    expect(budget.details.oversizedCount).toBe(1);
  });

  it("flags broken heading hierarchy (multiple H1)", () => {
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    // Two H1 in same file → violation
    fs.writeFileSync(path.join(docsDir, "bad.md"), "# First\n\nText.\n\n# Second\n\nText.");

    const r = runAgentReadiness(tmp);
    const heading = r.checks.find((c) => c.id === "heading-hierarchy");
    expect(heading.ok).toBe(false);
  });

  it("flags skipped heading levels (H1 → H3)", () => {
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "skip.md"), "# Title\n\n### Subsubsection\n\nWhere's H2?");

    const r = runAgentReadiness(tmp);
    const heading = r.checks.find((c) => c.id === "heading-hierarchy");
    expect(heading.ok).toBe(false);
  });

  it("accepts robots.txt under public/ or static/", () => {
    fs.mkdirSync(path.join(tmp, "public"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "public", "robots.txt"), "User-agent: ClaudeBot\nAllow: /\n");
    const r = runAgentReadiness(tmp);
    const robots = r.checks.find((c) => c.id === "robots-allowlist");
    expect(robots.ok).toBe(true);
  });

  it("topFixes are ordered by weight descending (most impactful first)", () => {
    // Bare repo → multiple failures
    const r = runAgentReadiness(tmp);
    const weights = r.topFixes.map((f) => f.weightLost);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i - 1]).toBeGreaterThanOrEqual(weights[i]);
    }
  });

  it("never exceeds 100 score", () => {
    // Same fully-ready setup as the high-score test
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    fs.writeFileSync(path.join(tmp, "robots.txt"), "User-agent: GPTBot\nAllow: /");
    fs.mkdirSync(path.join(tmp, "docs/agents"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs/agents", "README.md"), "# Agents\n\n## Index");
    fs.writeFileSync(path.join(tmp, "docs/agents", "SKILL.k.md"), "# k\n\n## Inputs");
    const r = runAgentReadiness(tmp);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("does NOT count bash comments inside fenced code blocks as H1 (KJC-TSK-0350)", () => {
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    // Single real H1, plus a bash code block full of `# comment` lines.
    // Pre-fix the detector counted those as additional H1s and flagged
    // the file as broken — the audit on Karajan itself reported 26
    // false positives until this bug was fixed.
    fs.writeFileSync(path.join(docsDir, "bash.md"), [
      "# Real Title",
      "",
      "Some text.",
      "",
      "```bash",
      "# Show help",
      "kj --help",
      "",
      "# Run doctor",
      "kj doctor",
      "",
      "# Run the pipeline",
      "kj run",
      "```",
      "",
      "## Section",
      "",
      "More text.",
    ].join("\n"));

    const r = runAgentReadiness(tmp);
    const heading = r.checks.find((c) => c.id === "heading-hierarchy");
    expect(heading.ok, `details: ${JSON.stringify(heading.details)}`).toBe(true);
  });

  it("counts <h1> HTML tags as a valid H1 (centered banners) (KJC-TSK-0350)", () => {
    fs.writeFileSync(path.join(tmp, "llms.txt"), "# x\n\n## y\n\n[a](b)");
    const docsDir = path.join(tmp, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    // Bilingual / branded README pattern — the document title lives in
    // an `<h1 align="center">` HTML tag so badges + logo can centre
    // around it. Pre-fix the detector saw 0 markdown H1s and flagged
    // the file as broken.
    fs.writeFileSync(path.join(docsDir, "README.md"), [
      `<p align="center"><img src="logo.svg" alt="Logo"></p>`,
      `<h1 align="center">My Project</h1>`,
      "",
      "## Intro",
      "",
      "Text.",
    ].join("\n"));

    const r = runAgentReadiness(tmp);
    const heading = r.checks.find((c) => c.id === "heading-hierarchy");
    expect(heading.ok, `details: ${JSON.stringify(heading.details)}`).toBe(true);
  });

  it("isolates one check's exception from the others", () => {
    // Run on a non-existent path — most checks will fail (existsSync false)
    // but the function must not crash; it must return a report.
    const r = runAgentReadiness(path.join(tmp, "does-not-exist"));
    expect(r).toHaveProperty("score");
    expect(r.checks.length).toBe(7);
  });
});

describe("formatAgentReadinessReport", () => {
  it("renders score + per-check ✓/✗ + top fixes", () => {
    const r = runAgentReadiness(tmp);
    const txt = formatAgentReadinessReport(r, tmp);
    expect(txt).toContain(`/100`);
    expect(txt).toMatch(/[✓✗]/);
    expect(txt).toMatch(/Top fixes:|^\s*$/m);
  });
});
