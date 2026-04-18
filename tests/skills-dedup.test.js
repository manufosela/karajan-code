import { describe, expect, it } from "vitest";
import { buildSkillSection } from "../src/skills/skill-loader.js";

const fakeSkills = [
  { name: "java-code-review", content: "Long instructions about Java reviews...\n## Checks\n- null handling\n- exception leakage\n- generics variance\n" },
  { name: "pytest-patterns", content: "Fixtures, markers, parametrize cheatsheet" },
];

describe("skills/dedup — buildSkillSection per provider", () => {
  it("inlines full SKILL.md content when provider is null (back-compat)", () => {
    const section = buildSkillSection(fakeSkills);
    expect(section).toContain("Long instructions about Java reviews");
    expect(section).toContain("Fixtures, markers");
    expect(section).toContain("### java-code-review");
  });

  it("inlines full SKILL.md content for openai/google/opencode", () => {
    for (const provider of ["openai", "codex", "google", "gemini", "opencode"]) {
      const section = buildSkillSection(fakeSkills, { provider });
      expect(section, `provider=${provider}`).toContain("Long instructions about Java reviews");
    }
  });

  it("anthropic/claude emit reference list instead of full content", () => {
    const section = buildSkillSection(fakeSkills, { provider: "anthropic" });
    expect(section).not.toContain("Long instructions about Java reviews");
    expect(section).not.toContain("Fixtures, markers");
    expect(section).toContain("java-code-review, pytest-patterns");
    expect(section).toContain("Agent Skills capability");
  });

  it("claude alias maps to anthropic dedup behavior", () => {
    const sectionClaude = buildSkillSection(fakeSkills, { provider: "claude" });
    const sectionAnthropic = buildSkillSection(fakeSkills, { provider: "anthropic" });
    expect(sectionClaude).toBe(sectionAnthropic);
  });

  it("empty skills returns empty string regardless of provider", () => {
    expect(buildSkillSection([])).toBe("");
    expect(buildSkillSection([], { provider: "anthropic" })).toBe("");
    expect(buildSkillSection(null, { provider: "openai" })).toBe("");
  });

  it("reference section lists all skill names joined by comma", () => {
    const section = buildSkillSection(fakeSkills, { provider: "anthropic" });
    expect(section).toMatch(/java-code-review,\s*pytest-patterns/);
  });
});
