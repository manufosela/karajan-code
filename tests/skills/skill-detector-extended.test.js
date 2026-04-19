import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectNeededSkills } from "../../src/skills/skill-detector.js";

async function mkTmpProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "kj-detector-ext-"));
}

describe("skills/skill-detector — extended detection", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    cleanups.length = 0;
  });

  describe(".NET", () => {
    it("detects dotnet when a .csproj file exists", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "App.csproj"), "<Project/>");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("dotnet");
    });

    it("detects dotnet when a .sln file exists", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "MyApp.sln"), "Solution");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("dotnet");
    });
  });

  describe("Python deps", () => {
    it("detects python-data when pandas is in requirements.txt", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "requirements.txt"), "pandas==2.2.0\nnumpy>=1.24\n# scipy commented\n");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("python-data");
    });

    it("detects python-ml when torch is in pyproject.toml", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "pyproject.toml"), '[project]\ndependencies = ["torch", "pandas"]\n');
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("python-ml");
      expect(skills).toContain("python-data");
    });

    it("detects pytest-patterns when pytest is in requirements.txt", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "requirements.txt"), "pytest==8.0.0\n");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("pytest-patterns");
    });

    it("skips commented-out deps in requirements.txt", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "requirements.txt"), "# pandas==2.2.0\n");
      const skills = await detectNeededSkills("", dir);
      expect(skills).not.toContain("python-data");
    });
  });

  describe("Data / ML", () => {
    it("detects python-data when a .ipynb file exists in the repo", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "analysis.ipynb"), '{"cells": []}');
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("python-data");
    });

    it("finds notebooks in nested directories up to maxDepth", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.mkdir(path.join(dir, "notebooks"));
      await fs.writeFile(path.join(dir, "notebooks", "nb.ipynb"), "{}");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("python-data");
    });

    it("ignores node_modules during extension walk", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
      await fs.writeFile(path.join(dir, "node_modules", "pkg", "fixture.ipynb"), "{}");
      const skills = await detectNeededSkills("", dir);
      expect(skills).not.toContain("python-data");
    });
  });

  describe("Databases", () => {
    it("detects sql-analysis when any .sql file exists in the repo", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.mkdir(path.join(dir, "db"));
      await fs.writeFile(path.join(dir, "db", "schema.sql"), "CREATE TABLE users ();");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("sql-analysis");
    });

    it("detects prisma when schema.prisma exists", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "schema.prisma"), "generator client {}");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("prisma");
    });

    it("detects sql-analysis via migrations directory", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.mkdir(path.join(dir, "migrations"));
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("sql-analysis");
    });
  });

  describe("Testing frameworks via package.json", () => {
    it("detects playwright-patterns when @playwright/test is a dep", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
        devDependencies: { "@playwright/test": "^1.40.0" }
      }));
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("playwright-patterns");
    });

    it("detects vitest-patterns when vitest is a dep", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
        devDependencies: { vitest: "^1.0.0" }
      }));
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("vitest-patterns");
    });
  });

  describe("Extension walk bounds", () => {
    it("respects maxDepth option", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      // Put the marker file 4 levels deep
      const deep = path.join(dir, "a", "b", "c", "d");
      await fs.mkdir(deep, { recursive: true });
      await fs.writeFile(path.join(deep, "App.csproj"), "<Project/>");
      const defaultDepthSkills = await detectNeededSkills("", dir); // default 3
      expect(defaultDepthSkills).not.toContain("dotnet");
      const deeperSkills = await detectNeededSkills("", dir, { maxDepth: 5 });
      expect(deeperSkills).toContain("dotnet");
    });

    it("can disable the extension walk entirely", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "App.csproj"), "<Project/>");
      const skills = await detectNeededSkills("", dir, { includeExtensions: false });
      expect(skills).not.toContain("dotnet");
    });
  });

  describe("Backwards compat", () => {
    it("still detects astro via package.json and reacts to frontend text", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
        dependencies: { astro: "^4.0.0" }
      }));
      const skills = await detectNeededSkills("build a landing page CSS", dir);
      expect(skills).toContain("astro");
      expect(skills).toContain("frontend-design");
    });

    it("still detects java via pom.xml", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, "pom.xml"), "<project/>");
      const skills = await detectNeededSkills("", dir);
      expect(skills).toContain("java");
    });

    it("returns empty array when no signals and no task text", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      const skills = await detectNeededSkills("", dir);
      expect(skills).toEqual([]);
    });
  });
});
