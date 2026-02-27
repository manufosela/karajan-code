import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BaseRole, resolveRoleMdPath, loadFirstExisting } from "../src/roles/base-role.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("Role .md file resolution", () => {
  it("resolveRoleMdPath returns candidates in correct priority order", () => {
    const candidates = resolveRoleMdPath("coder", "/my/project");

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toBe(path.join("/my/project", ".karajan", "roles", "coder.md"));
    expect(candidates[1]).toContain(path.join(".karajan", "roles", "coder.md"));
    expect(candidates[2]).toContain(path.join("templates", "roles", "coder.md"));
  });

  it("resolveRoleMdPath skips project path when projectDir is falsy", () => {
    const candidates = resolveRoleMdPath("reviewer", null);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toContain(path.join(".karajan", "roles", "reviewer.md"));
    expect(candidates[1]).toContain(path.join("templates", "roles", "reviewer.md"));
  });

  it("resolveRoleMdPath uses role name for filename", () => {
    const candidates = resolveRoleMdPath("solomon", "/proj");
    for (const c of candidates) {
      expect(path.basename(c)).toBe("solomon.md");
    }
  });

  it("loadFirstExisting returns content of first found file", async () => {
    const content = await loadFirstExisting([
      "/nonexistent/path/a.md",
      "/nonexistent/path/b.md",
      path.resolve(import.meta.dirname, "..", "templates", "roles", "coder.md")
    ]);
    expect(content).toBeTruthy();
    expect(content).toContain("Coder");
  });

  it("loadFirstExisting returns null when no file exists", async () => {
    const content = await loadFirstExisting([
      "/nonexistent/aaa.md",
      "/nonexistent/bbb.md"
    ]);
    expect(content).toBeNull();
  });

  it("BaseRole.init() loads built-in .md for known roles", async () => {
    const role = new BaseRole({ name: "coder", config: {}, logger });
    await role.init();
    expect(role.instructions).toBeTruthy();
    expect(role.instructions).toContain("Coder");
  });

  it("BaseRole.init() sets instructions to null for unknown role", async () => {
    const role = new BaseRole({ name: "nonexistent-role-xyz", config: {}, logger });
    await role.init();
    expect(role.instructions).toBeNull();
  });

  describe("project override", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-role-test-"));
      await fs.mkdir(path.join(tmpDir, ".karajan", "roles"), { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("loads project-level .md over built-in when available", async () => {
      const overridePath = path.join(tmpDir, ".karajan", "roles", "coder.md");
      await fs.writeFile(overridePath, "# Custom Coder\nProject-specific instructions.");

      const role = new BaseRole({ name: "coder", config: { projectDir: tmpDir }, logger });
      await role.init();

      expect(role.instructions).toBe("# Custom Coder\nProject-specific instructions.");
    });
  });
});

describe("Built-in role templates exist", () => {
  const roles = ["coder", "reviewer", "refactorer", "researcher", "planner", "tester", "security", "commiter", "solomon", "karajan", "sonar"];

  for (const roleName of roles) {
    it(`templates/roles/${roleName}.md exists and is non-empty`, async () => {
      const mdPath = path.resolve(import.meta.dirname, "..", "templates", "roles", `${roleName}.md`);
      const content = await fs.readFile(mdPath, "utf8");
      expect(content.length).toBeGreaterThan(50);
    });
  }
});
