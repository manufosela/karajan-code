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

  async function seedFile(file, contents) {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const target = path.join(dir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
    return dir;
  }

  it.each([
    { label: ".csproj triggers dotnet", file: "App.csproj", contents: "<Project/>", task: "", includes: ["dotnet"], excludes: [] },
    { label: ".sln triggers dotnet", file: "MyApp.sln", contents: "Solution", task: "", includes: ["dotnet"], excludes: [] },
    { label: "pom.xml triggers java", file: "pom.xml", contents: "<project/>", task: "", includes: ["java"], excludes: [] },
    { label: "schema.prisma triggers prisma", file: "schema.prisma", contents: "generator client {}", task: "", includes: ["prisma"], excludes: [] },
    { label: "ipynb triggers python-data", file: "analysis.ipynb", contents: '{"cells": []}', task: "", includes: ["python-data"], excludes: [] },
    { label: "nested ipynb triggers python-data", file: "notebooks/nb.ipynb", contents: "{}", task: "", includes: ["python-data"], excludes: [] },
    { label: "any .sql file triggers sql-analysis", file: "db/schema.sql", contents: "CREATE TABLE users ();", task: "", includes: ["sql-analysis"], excludes: [] },
    { label: "pandas in requirements.txt triggers python-data", file: "requirements.txt", contents: "pandas==2.2.0\nnumpy>=1.24\n# scipy commented\n", task: "", includes: ["python-data"], excludes: [] },
    { label: "pytest in requirements.txt triggers pytest-patterns", file: "requirements.txt", contents: "pytest==8.0.0\n", task: "", includes: ["pytest-patterns"], excludes: [] },
    { label: "torch in pyproject.toml triggers python-ml + python-data", file: "pyproject.toml", contents: '[project]\ndependencies = ["torch", "pandas"]\n', task: "", includes: ["python-ml", "python-data"], excludes: [] },
    { label: "commented pandas does NOT trigger python-data", file: "requirements.txt", contents: "# pandas==2.2.0\n", task: "", includes: [], excludes: ["python-data"] },
    { label: "@playwright/test in package.json triggers playwright-patterns", file: "package.json", contents: JSON.stringify({ devDependencies: { "@playwright/test": "^1.40.0" } }), task: "", includes: ["playwright-patterns"], excludes: [] },
    { label: "vitest in package.json triggers vitest-patterns", file: "package.json", contents: JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }), task: "", includes: ["vitest-patterns"], excludes: [] },
    { label: "astro dep + frontend task triggers astro + frontend-design", file: "package.json", contents: JSON.stringify({ dependencies: { astro: "^4.0.0" } }), task: "build a landing page CSS", includes: ["astro", "frontend-design"], excludes: [] },
  ])("$label", async ({ file, contents, task, includes, excludes }) => {
    const dir = await seedFile(file, contents);
    const skills = await detectNeededSkills(task, dir);
    for (const s of includes) expect(skills).toContain(s);
    for (const s of excludes) expect(skills).not.toContain(s);
  });

  it("detects sql-analysis via migrations directory (no file payload required)", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.mkdir(path.join(dir, "migrations"));
    const skills = await detectNeededSkills("", dir);
    expect(skills).toContain("sql-analysis");
  });

  it("ignores node_modules during extension walk", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(dir, "node_modules", "pkg", "fixture.ipynb"), "{}");
    const skills = await detectNeededSkills("", dir);
    expect(skills).not.toContain("python-data");
  });

  it("respects maxDepth option (4-level deep marker only seen with maxDepth>=5)", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const deep = path.join(dir, "a", "b", "c", "d");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "App.csproj"), "<Project/>");
    expect(await detectNeededSkills("", dir)).not.toContain("dotnet");
    expect(await detectNeededSkills("", dir, { maxDepth: 5 })).toContain("dotnet");
  });

  it("can disable the extension walk entirely", async () => {
    const dir = await seedFile("App.csproj", "<Project/>");
    const skills = await detectNeededSkills("", dir, { includeExtensions: false });
    expect(skills).not.toContain("dotnet");
  });

  it("returns empty array when no signals and no task text", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const skills = await detectNeededSkills("", dir);
    expect(skills).toEqual([]);
  });
});
