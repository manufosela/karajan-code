import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let originalKarajanHome;

vi.mock("../../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => originalKarajanHome),
  getSessionRoot: vi.fn(() => path.join(originalKarajanHome, "sessions")),
}));

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

describe("skills/addyosmani-catalog", () => {
  let tmpHome;
  let mod;
  let runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kj-addyo-test-"));
    originalKarajanHome = tmpHome;
    const paths = await import("../../src/utils/paths.js");
    paths.getKarajanHome.mockReturnValue(tmpHome);
    ({ runCommand } = await import("../../src/utils/process.js"));
    mod = await import("../../src/skills/addyosmani-catalog.js");
    mod.__resetGitProbe();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  describe("parseFrontmatter", () => {
    it("extracts name and description from YAML frontmatter", () => {
      const raw = [
        "---",
        "name: test-driven-development",
        "description: Drives development with tests. Use when implementing logic.",
        "---",
        "",
        "# Test-Driven Development",
        "body content here",
      ].join("\n");

      const parsed = mod.parseFrontmatter(raw);
      expect(parsed.name).toBe("test-driven-development");
      expect(parsed.description).toContain("Drives development with tests");
      expect(parsed.body).toContain("# Test-Driven Development");
    });

    it("strips surrounding quotes from values", () => {
      const raw = '---\nname: "quoted-name"\ndescription: \'single-quoted\'\n---\nbody';
      const parsed = mod.parseFrontmatter(raw);
      expect(parsed.name).toBe("quoted-name");
      expect(parsed.description).toBe("single-quoted");
    });

    it("returns nulls and full body when no frontmatter present", () => {
      const raw = "# Just a heading\nNo frontmatter here.";
      const parsed = mod.parseFrontmatter(raw);
      expect(parsed.name).toBeNull();
      expect(parsed.description).toBeNull();
      expect(parsed.body).toBe(raw);
    });

    it("returns all-null on empty input", () => {
      const parsed = mod.parseFrontmatter("");
      expect(parsed.name).toBeNull();
      expect(parsed.description).toBeNull();
      expect(parsed.body).toBe("");
    });
  });

  describe("isGitAvailable", () => {
    it("returns true when git --version exits 0", async () => {
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version 2.40.0", stderr: "" });
      expect(await mod.isGitAvailable()).toBe(true);
    });

    it("returns false when git --version fails", async () => {
      runCommand.mockRejectedValueOnce(new Error("command not found"));
      expect(await mod.isGitAvailable()).toBe(false);
    });

    it("caches the result across calls", async () => {
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version 2.40", stderr: "" });
      await mod.isGitAvailable();
      await mod.isGitAvailable();
      expect(runCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("listAvailableSlugs", () => {
    it("returns [] when catalog directory does not exist", async () => {
      expect(await mod.listAvailableSlugs()).toEqual([]);
    });

    it("lists subdirectories of /skills/ sorted alphabetically", async () => {
      const skillsRoot = path.join(mod.getCatalogRoot(), "skills");
      await fs.mkdir(path.join(skillsRoot, "test-driven-development"), { recursive: true });
      await fs.mkdir(path.join(skillsRoot, "code-review-and-quality"), { recursive: true });
      await fs.mkdir(path.join(skillsRoot, "security-and-hardening"), { recursive: true });
      // hidden dir must be excluded
      await fs.mkdir(path.join(skillsRoot, ".git"), { recursive: true });

      const slugs = await mod.listAvailableSlugs();
      expect(slugs).toEqual([
        "code-review-and-quality",
        "security-and-hardening",
        "test-driven-development",
      ]);
    });
  });

  describe("loadSkillBySlug", () => {
    it("returns null for missing slug", async () => {
      expect(await mod.loadSkillBySlug("nonexistent")).toBeNull();
    });

    it("returns null for invalid slug input", async () => {
      expect(await mod.loadSkillBySlug("")).toBeNull();
      expect(await mod.loadSkillBySlug(null)).toBeNull();
      expect(await mod.loadSkillBySlug(undefined)).toBeNull();
    });

    it("loads SKILL.md and parses frontmatter", async () => {
      const slug = "test-driven-development";
      const dir = path.join(mod.getCatalogRoot(), "skills", slug);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: test-driven-development\ndescription: Drives dev with tests\n---\n# Body"
      );

      const skill = await mod.loadSkillBySlug(slug);
      expect(skill).not.toBeNull();
      expect(skill.slug).toBe(slug);
      expect(skill.name).toBe("test-driven-development");
      expect(skill.description).toBe("Drives dev with tests");
      expect(skill.content).toContain("# Body");
    });

    it("rejects path traversal in slug", async () => {
      expect(await mod.loadSkillBySlug("../../etc/passwd")).toBeNull();
    });
  });

  describe("ensureCatalog", () => {
    it("is a no-op when .git exists already", async () => {
      await fs.mkdir(path.join(mod.getCatalogRoot(), ".git"), { recursive: true });
      const result = await mod.ensureCatalog();
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("returns ok: false when git is not available", async () => {
      runCommand.mockRejectedValueOnce(new Error("not found"));
      const result = await mod.ensureCatalog();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/git not available/i);
    });

    it("runs git clone when catalog does not exist and writes meta.json", async () => {
      // 1st call: git --version → ok ; 2nd call: git clone → ok
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

      const result = await mod.ensureCatalog();
      expect(result.ok).toBe(true);
      expect(runCommand).toHaveBeenCalledTimes(2);
      expect(runCommand).toHaveBeenLastCalledWith(
        "git",
        expect.arrayContaining(["clone", "--depth", "1"]),
        expect.objectContaining({ timeout: expect.any(Number) })
      );

      const metaPath = path.join(mod.getCatalogRoot(), ".karajan-catalog-meta.json");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      expect(meta.repoUrl).toBeTruthy();
      expect(typeof meta.clonedAt).toBe("string");
      expect(typeof meta.lastPullAt).toBe("string");
    });

    it("surfaces clone failures without throwing", async () => {
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "fatal: network down" });

      const result = await mod.ensureCatalog();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("network down");
    });
  });

  describe("refreshIfStale", () => {
    async function seedCatalog({ lastPullAgoMs = 0 } = {}) {
      await fs.mkdir(path.join(mod.getCatalogRoot(), ".git"), { recursive: true });
      const meta = {
        repoUrl: "https://github.com/addyosmani/agent-skills.git",
        clonedAt: new Date(Date.now() - lastPullAgoMs).toISOString(),
        lastPullAt: new Date(Date.now() - lastPullAgoMs).toISOString(),
      };
      await fs.writeFile(
        path.join(mod.getCatalogRoot(), ".karajan-catalog-meta.json"),
        JSON.stringify(meta)
      );
    }

    it("returns 'fresh' when cache is within TTL", async () => {
      await seedCatalog({ lastPullAgoMs: 60 * 1000 }); // 1 min ago
      const result = await mod.refreshIfStale({ refreshMs: 7 * 24 * 60 * 60 * 1000 });
      expect(result.ok).toBe(true);
      expect(result.action).toBe("fresh");
      expect(runCommand).not.toHaveBeenCalled();
    });

    it("pulls when cache is older than TTL", async () => {
      await seedCatalog({ lastPullAgoMs: 8 * 24 * 60 * 60 * 1000 });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

      const result = await mod.refreshIfStale({ refreshMs: 7 * 24 * 60 * 60 * 1000 });
      expect(result.ok).toBe(true);
      expect(result.action).toBe("pulled");
    });

    it("force:true bypasses TTL check and always pulls", async () => {
      await seedCatalog({ lastPullAgoMs: 60 * 1000 });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

      const result = await mod.refreshIfStale({ force: true });
      expect(result.action).toBe("pulled");
    });

    it("degrades to 'skipped' without error when git pull fails", async () => {
      await seedCatalog({ lastPullAgoMs: 8 * 24 * 60 * 60 * 1000 });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "conflict" });

      const result = await mod.refreshIfStale({ refreshMs: 0 });
      expect(result.ok).toBe(false);
      expect(result.action).toBe("skipped");
    });

    it("delegates to ensureCatalog when catalog is absent", async () => {
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "git version", stderr: "" });
      runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

      const result = await mod.refreshIfStale();
      expect(result.ok).toBe(true);
      expect(result.action).toBe("cloned");
    });
  });
});
