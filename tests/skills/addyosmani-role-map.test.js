import { describe, expect, it } from "vitest";
import {
  resolveAddyosmaniSlugs,
  ROLE_TO_ADDYOSMANI_SLUGS,
  TASK_PATTERN_TO_SLUG,
} from "../../src/skills/addyosmani-role-map.js";

describe("skills/addyosmani-role-map", () => {
  describe("resolveAddyosmaniSlugs", () => {
    it("returns [] when no role and no task is given", () => {
      expect(resolveAddyosmaniSlugs({})).toEqual([]);
    });

    it("maps tester role to TDD + browser testing slugs", () => {
      const slugs = resolveAddyosmaniSlugs({ role: "tester" });
      expect(slugs).toContain("test-driven-development");
      expect(slugs).toContain("browser-testing-with-devtools");
    });

    it("maps reviewer role to review + simplification slugs", () => {
      const slugs = resolveAddyosmaniSlugs({ role: "reviewer" });
      expect(slugs).toContain("code-review-and-quality");
      expect(slugs).toContain("code-simplification");
    });

    it("maps security role to hardening slug", () => {
      expect(resolveAddyosmaniSlugs({ role: "security" })).toContain("security-and-hardening");
    });

    it("maps architect role to spec/API/planning slugs", () => {
      const slugs = resolveAddyosmaniSlugs({ role: "architect" });
      expect(slugs).toContain("spec-driven-development");
      expect(slugs).toContain("api-and-interface-design");
      expect(slugs).toContain("planning-and-task-breakdown");
    });

    it("returns [] for unknown role with no task", () => {
      expect(resolveAddyosmaniSlugs({ role: "unknown-role" })).toEqual([]);
    });

    it("infers performance-optimization from task text", () => {
      const slugs = resolveAddyosmaniSlugs({ task: "Improve Core Web Vitals and LCP on landing" });
      expect(slugs).toContain("performance-optimization");
    });

    it("infers security-and-hardening from task keywords", () => {
      const slugs = resolveAddyosmaniSlugs({ task: "Fix XSS in user form" });
      expect(slugs).toContain("security-and-hardening");
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

  describe("role catalog integrity", () => {
    it("every known Karajan role has at least one addyosmani slug mapped", () => {
      const roles = ["coder", "reviewer", "tester", "security", "architect", "planner", "impeccable", "refactorer"];
      for (const role of roles) {
        expect(ROLE_TO_ADDYOSMANI_SLUGS[role], `role ${role}`).toBeDefined();
        expect(ROLE_TO_ADDYOSMANI_SLUGS[role].length).toBeGreaterThan(0);
      }
    });

    it("slugs are lowercase-hyphenated (marketplace convention)", () => {
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
});
