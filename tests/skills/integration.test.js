import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
  installSkill: vi.fn(),
  removeSkill: vi.fn(),
}));

vi.mock("../../src/skills/skill-loader.js", async () => {
  const actual = await vi.importActual("../../src/skills/skill-loader.js");
  return {
    ...actual,
    loadAvailableSkills: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../src/skills/skills-cache.js", () => ({
  isFresh: vi.fn().mockResolvedValue(false),
  recordInstall: vi.fn().mockResolvedValue(undefined),
}));

/**
 * End-to-end(-ish) integration: detectNeededSkills + autoInstallSkills +
 * buildSkillSection, wired together with the role filter and Claude dedup.
 * Covers the full "detect → install → inject into role prompt" pipeline.
 */

async function mkTmpProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "kj-skills-integ-"));
}

describe("skills integration — detect → install → inject", () => {
  const cleanups = [];
  let detectNeededSkills, autoInstallSkills;
  let buildSkillSection, filterSkillsForRole;
  let client;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ detectNeededSkills, autoInstallSkills } = await import("../../src/skills/skill-detector.js"));
    ({ buildSkillSection, filterSkillsForRole } = await import("../../src/skills/skill-loader.js"));
    client = await import("../../src/skills/openskills-client.js");
    const loader = await import("../../src/skills/skill-loader.js");
    loader.loadAvailableSkills.mockResolvedValue([]);
    const cache = await import("../../src/skills/skills-cache.js");
    cache.isFresh.mockResolvedValue(false);
    cache.recordInstall.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    cleanups.length = 0;
  });

  it("Python project with pandas + pytest → installs python-data + pytest-patterns; reviewer gets neither", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.writeFile(path.join(dir, "requirements.txt"), "pandas==2.2.0\npytest==8.0.0\n");

    client.isOpenSkillsAvailable.mockResolvedValue(true);
    client.installSkill.mockImplementation(async (name) => ({ ok: true, name }));

    const detected = await detectNeededSkills("clean the data and write tests", dir);
    expect(detected).toContain("python-data");
    expect(detected).toContain("pytest-patterns");

    const installed = await autoInstallSkills(detected, dir);
    expect(installed.installed).toContain("python-data");
    expect(installed.installed).toContain("pytest-patterns");

    // Reviewer filter: neither pytest-patterns nor python-data should reach the reviewer.
    const skills = installed.installed.map((n) => ({ name: n, content: `skill ${n}` }));
    const reviewerOnly = filterSkillsForRole(skills, "reviewer");
    expect(reviewerOnly.map((s) => s.name)).not.toContain("python-data");
    expect(reviewerOnly.map((s) => s.name)).not.toContain("pytest-patterns");
  });

  it("Java project with pom.xml → coder sees java, reviewer sees java-code-review only when it exists in skills catalog", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.writeFile(path.join(dir, "pom.xml"), "<project/>");

    const detected = await detectNeededSkills("refactor the service layer", dir);
    expect(detected).toContain("java");

    // The coder gets the java skill; reviewer filter keeps only *-code-review.
    const skills = [
      { name: "java", content: "java general" },
      { name: "java-code-review", content: "java code review" },
    ];
    const coderView = filterSkillsForRole(skills, "coder");
    const reviewerView = filterSkillsForRole(skills, "reviewer");
    expect(coderView.map((s) => s.name)).toEqual(["java", "java-code-review"]);
    expect(reviewerView.map((s) => s.name)).toEqual(["java-code-review"]);
  });

  it("Claude provider dedups skill content in reviewer prompt", async () => {
    const skills = [
      { name: "java-code-review", content: "Long java review checklist...\n- null handling\n- etc" },
      { name: "owasp-top-10", content: "OWASP top 10 details..." },
    ];
    const section = buildSkillSection(skills, { role: "reviewer", provider: "claude" });
    expect(section).toContain("java-code-review");
    expect(section).toContain("owasp-top-10");
    expect(section).not.toContain("Long java review checklist");
    expect(section).toContain("Agent Skills capability");
  });

  it("OpenSkills CLI missing → installed is empty, wouldHaveUsed is populated", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { astro: "^4.0.0" } }));

    client.isOpenSkillsAvailable.mockResolvedValue(false);

    const detected = await detectNeededSkills("build a landing", dir);
    expect(detected).toContain("astro");

    const result = await autoInstallSkills(detected, dir);
    expect(result.osAvailable).toBe(false);
    expect(result.installed).toEqual([]);
    expect(result.wouldHaveUsed).toContain("astro");
  });

  it("Empty task + empty project → no skills detected, no install attempted", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const detected = await detectNeededSkills("", dir);
    expect(detected).toEqual([]);

    const result = await autoInstallSkills(detected, dir);
    expect(result.installed).toEqual([]);
    expect(result.wouldHaveUsed).toEqual([]);
    expect(client.isOpenSkillsAvailable).not.toHaveBeenCalled();
  });
});
