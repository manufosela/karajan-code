import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const { readFile, access } = await import("node:fs/promises");
const { detectNeededSkills } = await import("../src/skills/skill-detector.js");

describe("no-code skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockRejectedValue(new Error("ENOENT"));
    access.mockRejectedValue(new Error("ENOENT"));
  });

  describe("skill files exist and have correct format", () => {
    const templatesDir = path.resolve(import.meta.dirname, "..", "templates", "skills");

    it("sql-analysis skill file exists and has SKILL.md format content", () => {
      const content = readFileSync(path.join(templatesDir, "kj-sql-analysis.md"), "utf8");
      expect(content).toContain("# kj-sql-analysis");
      expect(content).toContain("## Your task");
      expect(content).toContain("$ARGUMENTS");
      expect(content).toContain("## Coder instructions");
      expect(content).toContain("## Reviewer checklist");
    });

    it("csv-transform skill file exists and has SKILL.md format content", () => {
      const content = readFileSync(path.join(templatesDir, "kj-csv-transform.md"), "utf8");
      expect(content).toContain("# kj-csv-transform");
      expect(content).toContain("## Your task");
      expect(content).toContain("$ARGUMENTS");
      expect(content).toContain("## Coder instructions");
      expect(content).toContain("## Reviewer checklist");
    });

    it("data-report skill file exists and has SKILL.md format content", () => {
      const content = readFileSync(path.join(templatesDir, "kj-data-report.md"), "utf8");
      expect(content).toContain("# kj-data-report");
      expect(content).toContain("## Your task");
      expect(content).toContain("$ARGUMENTS");
      expect(content).toContain("## Coder instructions");
      expect(content).toContain("## Reviewer checklist");
    });
  });

  describe("skill detector suggests no-code skills from task text", () => {
    it("suggests sql-analysis for 'Generate SQL queries'", async () => {
      const result = await detectNeededSkills("Generate SQL queries", null);
      expect(result).toContain("sql-analysis");
    });

    it("suggests sql-analysis for task mentioning 'database'", async () => {
      const result = await detectNeededSkills("Optimize the database schema", null);
      expect(result).toContain("sql-analysis");
    });

    it("suggests sql-analysis for task mentioning 'query'", async () => {
      const result = await detectNeededSkills("Write a query to fetch users", null);
      expect(result).toContain("sql-analysis");
    });

    it("suggests csv-transform for 'Transform this CSV'", async () => {
      const result = await detectNeededSkills("Transform this CSV", null);
      expect(result).toContain("csv-transform");
    });

    it("suggests csv-transform for task mentioning 'parse'", async () => {
      const result = await detectNeededSkills("Parse the uploaded data file", null);
      expect(result).toContain("csv-transform");
    });

    it("suggests data-report for 'Generate a sales report'", async () => {
      const result = await detectNeededSkills("Generate a sales report", null);
      expect(result).toContain("data-report");
    });

    it("suggests data-report for task mentioning 'analysis'", async () => {
      const result = await detectNeededSkills("Perform a cost analysis", null);
      expect(result).toContain("data-report");
    });

    it("suggests data-report for task mentioning 'findings'", async () => {
      const result = await detectNeededSkills("Summarize the audit findings", null);
      expect(result).toContain("data-report");
    });
  });
});
