import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolveRolePromptPaths,
  loadRoleInstructions,
  readFirstExisting,
} from "../../src/prompts/prompt-resolver.js";

/**
 * These tests use real temporary directories to exercise the actual fs lookup
 * logic. The built-in templates/roles/ is not touched; we only create files
 * in isolated tmpdirs and point projectDir at them.
 */

async function mkTmpProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-prompt-test-"));
  await fs.mkdir(path.join(dir, ".karajan", "roles"), { recursive: true });
  return dir;
}

describe("prompts/prompt-resolver", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    cleanups.length = 0;
    vi.restoreAllMocks();
  });

  describe("resolveRolePromptPaths", () => {
    it("omits per-provider entries when provider is null", () => {
      const { all, provider } = resolveRolePromptPaths("coder", null, "/tmp/p");
      expect(provider).toBeNull();
      expect(all.every((p) => !/anthropic\.md$|openai\.md$|google\.md$/.test(p))).toBe(true);
    });

    it("normalizes provider slugs (claude -> anthropic)", () => {
      const { provider, all } = resolveRolePromptPaths("coder", "claude", "/tmp/p");
      expect(provider).toBe("anthropic");
      expect(all.some((p) => p.endsWith(path.join("coder", "anthropic.md")))).toBe(true);
    });

    it("interleaves per-provider > default > legacy at every home tier", () => {
      const { all } = resolveRolePromptPaths("coder", "openai", "/tmp/p");
      // First project-dir triplet order must be: openai.md, default.md, legacy flat
      expect(all[0]).toMatch(/\.karajan\/roles\/coder\/openai\.md$/);
      expect(all[1]).toMatch(/\.karajan\/roles\/coder\/default\.md$/);
      expect(all[2]).toMatch(/\.karajan\/roles\/coder\.md$/);
    });

    it("throws on missing role name", () => {
      expect(() => resolveRolePromptPaths("", "openai")).toThrow();
      expect(() => resolveRolePromptPaths(undefined, "openai")).toThrow();
    });
  });

  describe("readFirstExisting", () => {
    it("returns first existing path contents", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      const a = path.join(dir, "a.md");
      const b = path.join(dir, "b.md");
      await fs.writeFile(b, "bbb");
      const hit = await readFirstExisting([a, b]);
      expect(hit).toEqual({ content: "bbb", path: b });
    });

    it("returns null when no path exists", async () => {
      const hit = await readFirstExisting(["/nope/x.md", "/nope/y.md"]);
      expect(hit).toBeNull();
    });
  });

  describe("loadRoleInstructions", () => {
    it("prefers per-provider file over default over legacy", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      const roleDir = path.join(dir, ".karajan", "roles", "coder");
      await fs.mkdir(roleDir, { recursive: true });
      await fs.writeFile(path.join(roleDir, "default.md"), "DEFAULT");
      await fs.writeFile(path.join(roleDir, "anthropic.md"), "ANTHROPIC");
      await fs.writeFile(path.join(dir, ".karajan", "roles", "coder.md"), "LEGACY");

      const result = await loadRoleInstructions({ role: "coder", provider: "claude", projectDir: dir });
      expect(result.instructions).toBe("ANTHROPIC");
      expect(result.fellBack).toBe(false);
      expect(result.resolvedProvider).toBe("anthropic");
    });

    it("falls back to default.md when per-provider missing", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      const roleDir = path.join(dir, ".karajan", "roles", "coder");
      await fs.mkdir(roleDir, { recursive: true });
      await fs.writeFile(path.join(roleDir, "default.md"), "DEFAULT");

      const logger = { debug: vi.fn(), warn: vi.fn() };
      const result = await loadRoleInstructions({ role: "coder", provider: "openai", projectDir: dir, logger });
      expect(result.instructions).toBe("DEFAULT");
      expect(result.fellBack).toBe(true);
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to legacy flat .md when no directory exists", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      await fs.writeFile(path.join(dir, ".karajan", "roles", "coder.md"), "LEGACY_FLAT");

      const result = await loadRoleInstructions({ role: "coder", provider: "openai", projectDir: dir });
      expect(result.instructions).toBe("LEGACY_FLAT");
      expect(result.fellBack).toBe(true);
    });

    it("returns null when no template is found anywhere", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      // Point the built-in templates away so the test is deterministic.
      const result = await loadRoleInstructions({ role: "nonexistent-role-xxx", provider: "openai", projectDir: dir });
      expect(result.instructions).toBeNull();
    });

    it("does NOT flag fallback when provider is not specified", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      const roleDir = path.join(dir, ".karajan", "roles", "coder");
      await fs.mkdir(roleDir, { recursive: true });
      await fs.writeFile(path.join(roleDir, "default.md"), "DEFAULT");

      const logger = { debug: vi.fn() };
      const result = await loadRoleInstructions({ role: "coder", provider: null, projectDir: dir, logger });
      expect(result.instructions).toBe("DEFAULT");
      expect(result.fellBack).toBe(false);
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("still finds a built-in template for coder when no overrides exist (via new per-role subdir or legacy flat)", async () => {
      const dir = await mkTmpProject();
      cleanups.push(dir);
      // After commit 3, templates/roles/coder/default.md exists and takes
      // precedence. The legacy templates/roles/coder.md is preserved as the
      // absolute last-resort fallback for back-compat.
      const result = await loadRoleInstructions({ role: "coder", provider: null, projectDir: dir });
      expect(result.instructions).toBeTruthy();
      expect(result.path).toMatch(/templates\/roles\/coder\/default\.md$|templates\/roles\/coder\.md$/);
    });
  });
});
