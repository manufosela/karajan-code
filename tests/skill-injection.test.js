import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn()
}));

const { readdir, readFile } = await import("node:fs/promises");
const { loadAvailableSkills, buildSkillSection } = await import("../src/skills/skill-loader.js");

describe("skill-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadAvailableSkills", () => {
    it("returns empty array when no skills directories exist", async () => {
      readdir.mockRejectedValue(new Error("ENOENT"));
      const result = await loadAvailableSkills("/project");
      expect(result).toEqual([]);
    });

    it("reads SKILL.md from .agent/skills/ subdirectories", async () => {
      readdir.mockImplementation(async (dir) => {
        if (dir === "/project/.agent/skills") {
          return [{ name: "react", isDirectory: () => true }];
        }
        throw new Error("ENOENT");
      });
      readFile.mockResolvedValue("React best practices content");

      const result = await loadAvailableSkills("/project");

      expect(result).toEqual([{ name: "react", content: "React best practices content" }]);
      expect(readFile).toHaveBeenCalledWith(
        "/project/.agent/skills/react/SKILL.md",
        "utf-8"
      );
    });

    it("reads SKILL.md from .claude/skills/ subdirectories", async () => {
      readdir.mockImplementation(async (dir) => {
        if (dir === "/project/.claude/skills") {
          return [{ name: "testing", isDirectory: () => true }];
        }
        throw new Error("ENOENT");
      });
      readFile.mockResolvedValue("Testing guidelines");

      const result = await loadAvailableSkills("/project");

      expect(result).toEqual([{ name: "testing", content: "Testing guidelines" }]);
    });

    it("reads from both directories and merges results", async () => {
      readdir.mockImplementation(async (dir) => {
        if (dir === "/project/.agent/skills") {
          return [{ name: "react", isDirectory: () => true }];
        }
        if (dir === "/project/.claude/skills") {
          return [{ name: "testing", isDirectory: () => true }];
        }
        throw new Error("ENOENT");
      });
      readFile.mockImplementation(async (path) => {
        if (path.includes("react")) return "React content";
        if (path.includes("testing")) return "Testing content";
        throw new Error("ENOENT");
      });

      const result = await loadAvailableSkills("/project");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: "react", content: "React content" });
      expect(result[1]).toEqual({ name: "testing", content: "Testing content" });
    });

    it("skips entries that are not directories", async () => {
      readdir.mockImplementation(async (dir) => {
        if (dir === "/project/.agent/skills") {
          return [
            { name: "README.md", isDirectory: () => false },
            { name: "react", isDirectory: () => true }
          ];
        }
        throw new Error("ENOENT");
      });
      readFile.mockResolvedValue("React content");

      const result = await loadAvailableSkills("/project");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("react");
    });

    it("skips subdirectories without SKILL.md", async () => {
      readdir.mockImplementation(async (dir) => {
        if (dir === "/project/.agent/skills") {
          return [{ name: "empty-skill", isDirectory: () => true }];
        }
        throw new Error("ENOENT");
      });
      readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await loadAvailableSkills("/project");

      expect(result).toEqual([]);
    });
  });

  describe("buildSkillSection", () => {
    it("returns empty string for empty array", () => {
      expect(buildSkillSection([])).toBe("");
    });

    it("returns empty string for null/undefined", () => {
      expect(buildSkillSection(null)).toBe("");
      expect(buildSkillSection(undefined)).toBe("");
    });

    it("builds section for one skill", () => {
      const section = buildSkillSection([{ name: "react", content: "React rules" }]);

      expect(section).toContain("## Domain Skills");
      expect(section).toContain("### react");
      expect(section).toContain("React rules");
    });

    it("builds section for multiple skills in order", () => {
      const section = buildSkillSection([
        { name: "react", content: "React rules" },
        { name: "testing", content: "Test guidelines" }
      ]);

      expect(section).toContain("### react");
      expect(section).toContain("### testing");
      const reactIdx = section.indexOf("### react");
      const testIdx = section.indexOf("### testing");
      expect(reactIdx).toBeLessThan(testIdx);
    });
  });
});

describe("skill injection into prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coder prompt unchanged when no skills directory exists", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({ task: "Do something", projectDir: "/project" });

    expect(prompt).toContain("Do something");
    expect(prompt).not.toContain("Domain Skills");
  });

  it("coder prompt includes skill content when skills exist", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.agent/skills") {
        return [{ name: "react", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue("Use functional components");

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({ task: "Build UI", projectDir: "/project" });

    expect(prompt).toContain("## Domain Skills");
    expect(prompt).toContain("### react");
    expect(prompt).toContain("Use functional components");
  });

  it("reviewer prompt includes skill content when skills exist", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.agent/skills") {
        return [{ name: "security", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue("Always validate input");

    const { buildReviewerPrompt } = await import("../src/prompts/reviewer.js");
    const prompt = await buildReviewerPrompt({
      task: "Review code",
      diff: "some diff",
      reviewRules: "be strict",
      mode: "standard",
      projectDir: "/project"
    });

    expect(prompt).toContain("## Domain Skills");
    expect(prompt).toContain("### security");
    expect(prompt).toContain("Always validate input");
  });

  it("architect prompt includes skill content when skills exist", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.agent/skills") {
        return [{ name: "aws", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue("Use Lambda for compute");

    const { buildArchitectPrompt } = await import("../src/prompts/architect.js");
    const prompt = await buildArchitectPrompt({
      task: "Design infra",
      instructions: "Follow best practices",
      projectDir: "/project"
    });

    expect(prompt).toContain("## Domain Skills");
    expect(prompt).toContain("### aws");
    expect(prompt).toContain("Use Lambda for compute");
  });

  it("prompts unchanged when projectDir is null", async () => {
    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({ task: "Do something" });

    expect(prompt).toContain("Do something");
    expect(prompt).not.toContain("Domain Skills");
    expect(readdir).not.toHaveBeenCalled();
  });
});
