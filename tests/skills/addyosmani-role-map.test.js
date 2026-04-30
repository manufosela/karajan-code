import { describe, expect, it } from "vitest";
import {
  resolveAddyosmaniSlugs,
  ROLE_TO_ADDYOSMANI_SLUGS,
  TASK_PATTERN_TO_SLUG,
} from "../../src/skills/addyosmani-role-map.js";

describe("skills/addyosmani-role-map — resolveAddyosmaniSlugs", () => {
  it("returns [] when no role and no task is given", () => {
    expect(resolveAddyosmaniSlugs({})).toEqual([]);
  });

  it("returns [] for unknown role with no task", () => {
    expect(resolveAddyosmaniSlugs({ role: "unknown-role" })).toEqual([]);
  });

  it.each([
    { role: "tester", expected: ["test-driven-development", "browser-testing-with-devtools"] },
    { role: "reviewer", expected: ["code-review-and-quality", "code-simplification"] },
    { role: "security", expected: ["security-and-hardening"] },
    { role: "architect", expected: ["spec-driven-development", "api-and-interface-design", "planning-and-task-breakdown"] },
  ])("$role role maps to its canonical slug list", ({ role, expected }) => {
    const slugs = resolveAddyosmaniSlugs({ role });
    for (const slug of expected) expect(slugs).toContain(slug);
  });

  it.each([
    { task: "Improve Core Web Vitals and LCP on landing", expected: "performance-optimization" },
    { task: "Fix XSS in user form", expected: "security-and-hardening" },
  ])("infers '$expected' from task text", ({ task, expected }) => {
    expect(resolveAddyosmaniSlugs({ task })).toContain(expected);
  });

  it("combines role slugs first, then task slugs (role-first ordering)", () => {
    const slugs = resolveAddyosmaniSlugs({
      role: "reviewer",
      task: "Optimize performance of API endpoints",
    });
    expect(slugs[0]).toBe("code-review-and-quality");
    expect(slugs[1]).toBe("code-simplification");
    expect(slugs).toContain("performance-optimization");
    expect(slugs).toContain("api-and-interface-design");
  });

  it("dedupes when role and task suggest the same slug", () => {
    const slugs = resolveAddyosmaniSlugs({
      role: "tester",
      task: "Use TDD to add coverage",
    });
    const tddHits = slugs.filter((s) => s === "test-driven-development");
    expect(tddHits).toHaveLength(1);
  });

  it("ignores non-string task input", () => {
    const slugs = resolveAddyosmaniSlugs({ role: "tester", task: 42 });
    expect(slugs).toEqual(["test-driven-development", "browser-testing-with-devtools"]);
  });
});

describe("skills/addyosmani-role-map — role catalog integrity", () => {
  it.each([
    "coder", "reviewer", "tester", "security",
    "architect", "planner", "impeccable", "refactorer",
  ])("known Karajan role '%s' has at least one addyosmani slug mapped", (role) => {
    expect(ROLE_TO_ADDYOSMANI_SLUGS[role], `role ${role}`).toBeDefined();
    expect(ROLE_TO_ADDYOSMANI_SLUGS[role].length).toBeGreaterThan(0);
  });

  it("all slugs follow lowercase-hyphenated marketplace convention", () => {
    const allSlugs = new Set();
    for (const list of Object.values(ROLE_TO_ADDYOSMANI_SLUGS)) {
      for (const s of list) allSlugs.add(s);
    }
    for (const { slug } of TASK_PATTERN_TO_SLUG) allSlugs.add(slug);
    for (const slug of allSlugs) {
      expect(slug, `slug "${slug}"`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
