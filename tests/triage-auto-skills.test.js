import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => {
  const readFile = vi.fn();
  const readdir = vi.fn();
  const access = vi.fn();
  return {
    readFile,
    readdir,
    access,
    default: { readFile, readdir, access }
  };
});

vi.mock("../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
  installSkill: vi.fn(),
  removeSkill: vi.fn()
}));

vi.mock("../src/skills/skill-loader.js", () => ({
  loadAvailableSkills: vi.fn()
}));

const { readFile, readdir, access } = await import("node:fs/promises");
const { isOpenSkillsAvailable, installSkill, removeSkill } = await import("../src/skills/openskills-client.js");
const { loadAvailableSkills } = await import("../src/skills/skill-loader.js");
const { detectNeededSkills, autoInstallSkills, cleanupAutoInstalledSkills } = await import("../src/skills/skill-detector.js");

describe("skill-detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockRejectedValue(new Error("ENOENT"));
    readdir.mockRejectedValue(new Error("ENOENT"));
    access.mockRejectedValue(new Error("ENOENT"));
    loadAvailableSkills.mockResolvedValue([]);
    isOpenSkillsAvailable.mockResolvedValue(true);
    installSkill.mockResolvedValue({ ok: true, name: "test-skill" });
    removeSkill.mockResolvedValue({ ok: true });
  });

  describe("detectNeededSkills", () => {
    it("detects astro from package.json", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        dependencies: { astro: "^4.0.0" }
      }));

      const result = await detectNeededSkills("Build a page", "/project");

      expect(result).toContain("astro");
    });

    it("detects react from package.json devDependencies", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        devDependencies: { react: "^18.0.0", "react-dom": "^18.0.0" }
      }));

      const result = await detectNeededSkills("Build a component", "/project");

      expect(result).toContain("react");
      // react-dom also maps to "react", so should only appear once
      expect(result.filter(s => s === "react")).toHaveLength(1);
    });

    it("detects 'react' skill from task text mentioning React component", async () => {
      const result = await detectNeededSkills("Create a React component for the dashboard", "/project");

      expect(result).toContain("react");
    });

    it("detects go skill when go.mod exists", async () => {
      access.mockImplementation(async (filePath) => {
        if (filePath === "/project/go.mod") return undefined;
        throw new Error("ENOENT");
      });

      const result = await detectNeededSkills("Build an API", "/project");

      expect(result).toContain("go");
    });

    it("detects rust skill when Cargo.toml exists", async () => {
      access.mockImplementation(async (filePath) => {
        if (filePath === "/project/Cargo.toml") return undefined;
        throw new Error("ENOENT");
      });

      const result = await detectNeededSkills("Build a CLI", "/project");

      expect(result).toContain("rust");
    });

    it("detects java skill when pom.xml exists", async () => {
      access.mockImplementation(async (filePath) => {
        if (filePath === "/project/pom.xml") return undefined;
        throw new Error("ENOENT");
      });

      const result = await detectNeededSkills("Add endpoint", "/project");

      expect(result).toContain("java");
    });

    it("returns empty array when no frameworks detected", async () => {
      const result = await detectNeededSkills("Fix a typo in the README", "/project");

      expect(result).toEqual([]);
    });

    it("combines package.json and task text detections", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        dependencies: { express: "^4.0.0" }
      }));

      const result = await detectNeededSkills("Build an Astro page with express backend", "/project");

      expect(result).toContain("express");
      expect(result).toContain("astro");
    });

    it("handles null projectDir gracefully", async () => {
      const result = await detectNeededSkills("Create a React component", null);

      expect(result).toContain("react");
    });

    it("handles null task gracefully", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        dependencies: { vue: "^3.0.0" }
      }));

      const result = await detectNeededSkills(null, "/project");

      expect(result).toContain("vue");
    });
  });

  describe("autoInstallSkills", () => {
    it("skips already installed skills", async () => {
      loadAvailableSkills.mockResolvedValue([{ name: "react", content: "content" }]);

      const result = await autoInstallSkills(["react"], "/project");

      expect(result.alreadyInstalled).toContain("react");
      expect(result.installed).toHaveLength(0);
      expect(installSkill).not.toHaveBeenCalled();
    });

    it("installs skills that are not yet installed", async () => {
      installSkill.mockResolvedValue({ ok: true, name: "astro" });

      const result = await autoInstallSkills(["astro"], "/project");

      expect(result.installed).toContain("astro");
      expect(installSkill).toHaveBeenCalledWith("astro", { projectDir: "/project" });
    });

    it("returns empty results when OpenSkills is unavailable", async () => {
      isOpenSkillsAvailable.mockResolvedValue(false);

      const result = await autoInstallSkills(["react", "vue"], "/project");

      expect(result.installed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.alreadyInstalled).toHaveLength(0);
      expect(installSkill).not.toHaveBeenCalled();
    });

    it("tracks failed installations", async () => {
      installSkill.mockResolvedValue({ ok: false, error: "not found" });

      const result = await autoInstallSkills(["nonexistent"], "/project");

      expect(result.failed).toContain("nonexistent");
      expect(result.installed).toHaveLength(0);
    });

    it("returns empty results for empty input", async () => {
      const result = await autoInstallSkills([], "/project");

      expect(result.installed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.alreadyInstalled).toHaveLength(0);
    });

    it("returns empty results for null input", async () => {
      const result = await autoInstallSkills(null, "/project");

      expect(result.installed).toHaveLength(0);
    });

    it("handles install exceptions gracefully", async () => {
      installSkill.mockRejectedValue(new Error("network error"));

      const result = await autoInstallSkills(["astro"], "/project");

      expect(result.failed).toContain("astro");
      expect(result.installed).toHaveLength(0);
    });
  });

  describe("cleanupAutoInstalledSkills", () => {
    it("removes auto-installed skills", async () => {
      removeSkill.mockResolvedValue({ ok: true });

      const result = await cleanupAutoInstalledSkills(["astro", "react"], "/project");

      expect(result.removed).toEqual(["astro", "react"]);
      expect(removeSkill).toHaveBeenCalledTimes(2);
    });

    it("tracks failed removals", async () => {
      removeSkill.mockResolvedValue({ ok: false, error: "not found" });

      const result = await cleanupAutoInstalledSkills(["ghost"], "/project");

      expect(result.failed).toContain("ghost");
      expect(result.removed).toHaveLength(0);
    });

    it("returns empty results for empty input", async () => {
      const result = await cleanupAutoInstalledSkills([], "/project");

      expect(result.removed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(removeSkill).not.toHaveBeenCalled();
    });

    it("returns empty results for null input", async () => {
      const result = await cleanupAutoInstalledSkills(null, "/project");

      expect(result.removed).toHaveLength(0);
    });
  });
});
