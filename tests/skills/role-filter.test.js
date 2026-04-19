import { describe, expect, it } from "vitest";
import { buildSkillSection, filterSkillsForRole } from "../../src/skills/skill-loader.js";

const SAMPLE_SKILLS = [
  { name: "react-patterns", content: "react" },
  { name: "java-code-review", content: "java code review" },
  { name: "java-security-checks", content: "java security" },
  { name: "pytest-patterns", content: "pytest" },
  { name: "sql-analysis", content: "sql" },
  { name: "prisma", content: "prisma" },
  { name: "owasp-top-10", content: "owasp" },
  { name: "python-data", content: "pandas" },
];

describe("skills/role-filter — filterSkillsForRole", () => {
  describe("reviewer", () => {
    it("includes *-code-review + security + sql-analysis allowlist, excludes irrelevant patterns", () => {
      const names = filterSkillsForRole(SAMPLE_SKILLS, "reviewer").map((s) => s.name);
      expect(names).toContain("java-code-review");
      expect(names).toContain("java-security-checks");
      expect(names).toContain("owasp-top-10");
      expect(names).toContain("sql-analysis");
      expect(names).not.toContain("react-patterns");
      expect(names).not.toContain("pytest-patterns");
      expect(names).not.toContain("python-data");
    });
  });

  describe("architect", () => {
    it("accepts broad context (anything except test-framework patterns)", () => {
      const names = filterSkillsForRole(SAMPLE_SKILLS, "architect").map((s) => s.name);
      // Architecture touches everything: patterns, databases, cloud, security...
      expect(names).toContain("react-patterns");
      expect(names).toContain("sql-analysis");
      expect(names).toContain("prisma");
      expect(names).toContain("owasp-top-10");
      expect(names).toContain("python-data");
      // But NOT test frameworks — those belong to the tester role.
      expect(names).not.toContain("pytest-patterns");
    });
  });

  describe("tester", () => {
    it("includes *-test/pytest/vitest/jest/playwright patterns only", () => {
      const extended = [
        ...SAMPLE_SKILLS,
        { name: "vitest-patterns", content: "" },
        { name: "jest-patterns", content: "" },
        { name: "playwright-patterns", content: "" },
      ];
      const names = filterSkillsForRole(extended, "tester").map((s) => s.name);
      expect(names).toContain("pytest-patterns");
      expect(names).toContain("vitest-patterns");
      expect(names).toContain("jest-patterns");
      expect(names).toContain("playwright-patterns");
      expect(names).not.toContain("react-patterns");
      expect(names).not.toContain("sql-analysis");
    });
  });

  describe("security", () => {
    it("includes only *-security / owasp / sast", () => {
      const names = filterSkillsForRole(SAMPLE_SKILLS, "security").map((s) => s.name);
      expect(names).toContain("java-security-checks");
      expect(names).toContain("owasp-top-10");
      expect(names).not.toContain("pytest-patterns");
      expect(names).not.toContain("react-patterns");
    });
  });

  describe("coder (unknown role) returns everything", () => {
    it("passes all skills through unchanged", () => {
      const names = filterSkillsForRole(SAMPLE_SKILLS, "coder").map((s) => s.name);
      expect(names).toHaveLength(SAMPLE_SKILLS.length);
    });

    it("returns all when role is null/undefined", () => {
      expect(filterSkillsForRole(SAMPLE_SKILLS, undefined)).toHaveLength(SAMPLE_SKILLS.length);
      expect(filterSkillsForRole(SAMPLE_SKILLS, null)).toHaveLength(SAMPLE_SKILLS.length);
    });
  });
});

describe("skills/role-filter — buildSkillSection applies filter", () => {
  it("filters before rendering when role is given", () => {
    const section = buildSkillSection(SAMPLE_SKILLS, { role: "reviewer" });
    expect(section).toContain("java-code-review");
    expect(section).not.toContain("react-patterns");
  });

  it("returns empty string when no skill matches the role filter", () => {
    const onlyReactSkills = [{ name: "react-patterns", content: "react" }];
    const section = buildSkillSection(onlyReactSkills, { role: "tester" });
    expect(section).toBe("");
  });

  it("anthropic + role applies both filter and reference-mode dedup", () => {
    const section = buildSkillSection(SAMPLE_SKILLS, { role: "reviewer", provider: "claude" });
    expect(section).toContain("Agent Skills capability");
    expect(section).toContain("java-code-review");
    expect(section).not.toContain("java code review"); // content not inlined
    expect(section).not.toContain("react-patterns"); // filtered out
  });
});
