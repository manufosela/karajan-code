import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";

vi.mock("../src/roles/base-role.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    loadFirstExisting: vi.fn()
  };
});

const { resolveReviewProfile } = await import("../src/review/profiles.js");
const { loadFirstExisting } = await import("../src/roles/base-role.js");

describe("review/profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveReviewProfile", () => {
    it("returns mode-specific rules when file exists", async () => {
      loadFirstExisting.mockImplementation((paths) => {
        const modeFile = paths.find((p) => p.includes("reviewer-paranoid"));
        if (modeFile) return "Paranoid rules content";
        return null;
      });

      const result = await resolveReviewProfile({ mode: "paranoid", projectDir: "/project" });
      expect(result.rules).toContain("Paranoid rules content");
      expect(result.mode).toBe("paranoid");
    });

    it("falls back to base reviewer.md when mode file not found", async () => {
      loadFirstExisting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("Base reviewer rules");

      const result = await resolveReviewProfile({ mode: "standard", projectDir: "/project" });
      expect(result.rules).toContain("Base reviewer rules");
      expect(result.mode).toBe("standard");
    });

    it("returns default fallback when no files found", async () => {
      loadFirstExisting.mockResolvedValue(null);

      const result = await resolveReviewProfile({ mode: "standard", projectDir: "/project" });
      expect(result.rules).toContain("critical issues");
      expect(result.mode).toBe("standard");
    });

    it("resolves paranoid profile", async () => {
      loadFirstExisting.mockImplementation((paths) => {
        if (paths.some((p) => p.includes("reviewer-paranoid"))) return "paranoid content";
        return null;
      });

      const result = await resolveReviewProfile({ mode: "paranoid", projectDir: "/project" });
      expect(result.rules).toBe("paranoid content");
    });

    it("resolves strict profile", async () => {
      loadFirstExisting.mockImplementation((paths) => {
        if (paths.some((p) => p.includes("reviewer-strict"))) return "strict content";
        return null;
      });

      const result = await resolveReviewProfile({ mode: "strict", projectDir: "/project" });
      expect(result.rules).toBe("strict content");
    });

    it("resolves relaxed profile", async () => {
      loadFirstExisting.mockImplementation((paths) => {
        if (paths.some((p) => p.includes("reviewer-relaxed"))) return "relaxed content";
        return null;
      });

      const result = await resolveReviewProfile({ mode: "relaxed", projectDir: "/project" });
      expect(result.rules).toBe("relaxed content");
    });

    it("custom mode only checks base reviewer.md", async () => {
      loadFirstExisting.mockResolvedValueOnce("custom rules from project");

      const result = await resolveReviewProfile({ mode: "custom", projectDir: "/project" });
      expect(result.rules).toBe("custom rules from project");
      expect(result.mode).toBe("custom");
    });

    it("standard mode resolves built-in template when no overrides", async () => {
      loadFirstExisting.mockImplementation((paths) => {
        const builtin = paths.find((p) => p.includes("templates/roles/reviewer.md"));
        if (builtin) return "Built-in reviewer template";
        return null;
      });

      const result = await resolveReviewProfile({ mode: "standard", projectDir: "/project" });
      expect(result.rules).toContain("Built-in reviewer template");
    });
  });
});
