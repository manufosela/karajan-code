import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contract tests: every per-provider variant of every migrated role must
 * satisfy the same contract as its default variant. The contract is:
 *
 *   - same JSON output schema (inferred by the presence of a JSON block with
 *     the expected top-level keys)
 *   - same role name in the title
 *   - non-empty body
 *
 * Variants are free to restructure the prompt (XML tags, few-shot, imperative
 * markdown, ...) but cannot drop the canonical output schema. If a variant
 * silently changes the JSON shape it could break downstream parsers.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES_DIR = path.join(ROOT, "templates", "roles");

const MIGRATED_ROLES = [
  {
    role: "coder",
    titleMatch: /Coder/i,
    requiredJsonKeys: ["ok", "result", "summary"],
    requiredResultKeys: ["files_modified", "files_created", "tests_added", "approach"],
  },
  {
    role: "reviewer",
    titleMatch: /Reviewer/i,
    requiredJsonKeys: ["ok", "result", "summary"],
    requiredResultKeys: ["approved", "blocking_issues", "non_blocking_suggestions", "confidence"],
  },
  {
    role: "planner",
    titleMatch: /Planner/i,
    requiredJsonKeys: ["ok", "result", "summary"],
    requiredResultKeys: ["approach", "steps", "risks", "out_of_scope"],
  },
  {
    role: "architect",
    titleMatch: /Architect/i,
    requiredJsonKeys: ["verdict", "architecture", "questions", "summary"],
    requiredResultKeys: null, // architect has a different top-level shape
  },
  {
    role: "solomon",
    titleMatch: /Solomon/i,
    requiredJsonKeys: ["verdict", "reasoning", "confidence", "priority"],
    requiredResultKeys: null,
  },
];

const PROVIDERS = ["default", "anthropic", "openai", "google", "opencode"];

async function readTemplate(role, variant) {
  return fs.readFile(path.join(TEMPLATES_DIR, role, `${variant}.md`), "utf8");
}

describe("prompt templates — contract across provider variants", () => {
  for (const { role, titleMatch, requiredJsonKeys, requiredResultKeys } of MIGRATED_ROLES) {
    describe(`role: ${role}`, () => {
      for (const variant of PROVIDERS) {
        describe(`variant: ${variant}`, () => {
          it("exists and is non-empty", async () => {
            const content = await readTemplate(role, variant);
            expect(content.length).toBeGreaterThan(50);
          });

          it("mentions the role in its heading", async () => {
            const content = await readTemplate(role, variant);
            expect(content).toMatch(titleMatch);
          });

          it("includes a JSON output block with the canonical top-level keys", async () => {
            const content = await readTemplate(role, variant);
            for (const key of requiredJsonKeys) {
              const re = new RegExp(`"${key}"\\s*:`);
              expect(content, `${role}/${variant}.md missing "${key}" in JSON schema`).toMatch(re);
            }
          });

          if (requiredResultKeys) {
            it("includes the canonical keys inside the result object", async () => {
              const content = await readTemplate(role, variant);
              for (const key of requiredResultKeys) {
                const re = new RegExp(`"${key}"\\s*:`);
                expect(content, `${role}/${variant}.md missing "${key}" in result schema`).toMatch(re);
              }
            });
          }
        });
      }

      it("has at least 4 provider variants plus default", async () => {
        const dir = path.join(TEMPLATES_DIR, role);
        const entries = await fs.readdir(dir);
        const mdFiles = entries.filter((e) => e.endsWith(".md"));
        expect(mdFiles).toContain("default.md");
        expect(mdFiles).toContain("anthropic.md");
        expect(mdFiles).toContain("openai.md");
        expect(mdFiles).toContain("google.md");
        expect(mdFiles).toContain("opencode.md");
      });
    });
  }
});

describe("prompt-resolver — end-to-end integration with all variants", () => {
  it("resolves every migrated role for every provider from the built-in directory", async () => {
    const { loadRoleInstructions } = await import("../../src/prompts/prompt-resolver.js");

    for (const { role } of MIGRATED_ROLES) {
      for (const provider of ["claude", "codex", "gemini", "opencode"]) {
        const result = await loadRoleInstructions({
          role,
          provider,
          projectDir: "/nonexistent-project-dir-for-isolation",
        });
        expect(result.instructions, `${role} / ${provider}`).toBeTruthy();
        expect(result.instructions.length, `${role} / ${provider}`).toBeGreaterThan(50);
        expect(result.fellBack, `${role} / ${provider} should NOT fall back`).toBe(false);
      }
    }
  });
});
