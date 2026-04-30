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

const TEST_FRAMEWORK_SKILLS = [
  { name: "vitest-patterns", content: "" },
  { name: "jest-patterns", content: "" },
  { name: "playwright-patterns", content: "" },
];

describe("skills/role-filter — filterSkillsForRole", () => {
  it.each([
    {
      role: "reviewer",
      input: SAMPLE_SKILLS,
      includes: ["java-code-review", "java-security-checks", "owasp-top-10", "sql-analysis"],
      excludes: ["react-patterns", "pytest-patterns", "python-data"],
    },
    {
      role: "architect",
      input: SAMPLE_SKILLS,
      includes: ["react-patterns", "sql-analysis", "prisma", "owasp-top-10", "python-data"],
      excludes: ["pytest-patterns"],
    },
    {
      role: "tester",
      input: [...SAMPLE_SKILLS, ...TEST_FRAMEWORK_SKILLS],
      includes: ["pytest-patterns", "vitest-patterns", "jest-patterns", "playwright-patterns"],
      excludes: ["react-patterns", "sql-analysis"],
    },
    {
      role: "security",
      input: SAMPLE_SKILLS,
      includes: ["java-security-checks", "owasp-top-10"],
      excludes: ["pytest-patterns", "react-patterns"],
    },
  ])("$role role keeps the role-specific allowlist and drops the rest", ({ role, input, includes, excludes }) => {
    const names = filterSkillsForRole(input, role).map((s) => s.name);
    for (const name of includes) expect(names).toContain(name);
    for (const name of excludes) expect(names).not.toContain(name);
  });

  it.each([
    { label: "coder (unknown role)", role: "coder" },
    { label: "undefined role", role: undefined },
    { label: "null role", role: null },
  ])("$label passes all skills through unchanged", ({ role }) => {
    expect(filterSkillsForRole(SAMPLE_SKILLS, role)).toHaveLength(SAMPLE_SKILLS.length);
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
