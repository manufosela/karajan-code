import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoderPrompt, buildCoderPromptLayout } from "../../src/prompts/coder.js";

/**
 * Φ1-F (KJC-PCS-0057) — prefix-stability regression suite.
 *
 * Providers with automatic prefix caching (OpenAI ≥1024 tokens, Gemini
 * implicit, LiteLLM-routed) only hit when consecutive prompts share a
 * literal token prefix. These tests freeze that contract: any future
 * change to a prompt builder that slips volatile content into the stable
 * block — or reorders it between calls — fails here instead of silently
 * degrading cache_pct in production.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function longestCommonPrefix(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

// A realistic project setup: real shipped coder rules + a product
// context the size kj init typically produces. Everything here is
// per-project state — identical across HUs and iterations.
async function realisticBaseConfig() {
  const coderRules = await fs.readFile(path.join(repoRoot, "templates", "coder-rules.md"), "utf8");
  return {
    coderRules,
    methodology: "tdd",
    productContext: "Karajan Code is a multi-agent AI orchestrator CLI. It plans, codes, reviews and tests tasks via provider-agnostic subagents with deterministic guardrails.",
    domainContext: "Node.js ESM codebase, vitest test suite, conventional commits, PRs capped at 200 net LOC.",
    projectDir: repoRoot,
    stack: { language: "javascript", frameworks: ["node"] },
    testFramework: { hasTests: true, framework: "vitest", language: "javascript" },
  };
}

describe("prefix stability — coder prompt (Φ1-F)", () => {
  it("iteration N and N+1 of the same HU share the full stable block as literal prefix", async () => {
    const base = await realisticBaseConfig();
    const iter1 = await buildCoderPrompt({ ...base, task: "Add login endpoint" });
    const iter2 = await buildCoderPrompt({
      ...base,
      task: "Add login endpoint",
      reviewerFeedback: "Missing null check on the session token",
      sonarSummary: "1 code smell in auth.js",
    });
    const layout = await buildCoderPromptLayout({ ...base, task: "Add login endpoint" });

    const lcp = longestCommonPrefix(iter1, iter2);
    expect(lcp).toBeGreaterThanOrEqual(layout.stable.length);
  });

  it("two different HUs of the same plan share the full stable block as literal prefix", async () => {
    const base = await realisticBaseConfig();
    const huA = await buildCoderPrompt({
      ...base,
      task: "HU-001: create the user model",
      acceptanceTests: ["npm test -- user-model"],
      huId: "HU-001",
    });
    const huB = await buildCoderPrompt({
      ...base,
      task: "HU-002: expose the user REST API",
      acceptanceTests: [{ type: "gherkin", content: "Given a user\nWhen GET /users\nThen 200" }],
      huId: "HU-002",
    });
    const layout = await buildCoderPromptLayout({ ...base, task: "HU-001: create the user model" });

    const lcp = longestCommonPrefix(huA, huB);
    expect(lcp).toBeGreaterThanOrEqual(layout.stable.length);
  });

  it("stable block of a realistic project clears OpenAI's 1024-token caching minimum", async () => {
    const base = await realisticBaseConfig();
    const layout = await buildCoderPromptLayout({ ...base, task: "any task" });

    // ~4 chars per token is the standard rough estimate for English
    // prose. If this assertion ever fails, the stable block shrank
    // below the OpenAI prefix-caching floor and cold cache_pct on
    // codex will silently drop to zero — restructure before merging.
    const estimatedTokens = Math.round(layout.stable.length / 4);
    expect(estimatedTokens).toBeGreaterThanOrEqual(1024);
  });

  it("volatile content never leaks into the stable block", async () => {
    const base = await realisticBaseConfig();
    const markers = {
      task: "UNIQUE-TASK-MARKER-77f",
      reviewerFeedback: "UNIQUE-FEEDBACK-MARKER-77f",
      sonarSummary: "UNIQUE-SONAR-MARKER-77f",
      plan: "UNIQUE-PLAN-MARKER-77f",
      deferredContext: "UNIQUE-DEFERRED-MARKER-77f",
    };
    const layout = await buildCoderPromptLayout({ ...base, ...markers });

    for (const marker of Object.values(markers)) {
      expect(layout.stable).not.toContain(marker);
      expect(layout.volatile).toContain(marker);
    }
  });
});
