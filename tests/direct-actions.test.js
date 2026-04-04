import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

import { execSync } from "node:child_process";
const {
  executeAction, executeActions, getAllowedActionTypes, isCommandAllowed
} = await import("../src/orchestrator/direct-actions.js");

describe("direct-actions", () => {
  let tmpDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = path.join(os.tmpdir(), `kj-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  describe("isCommandAllowed", () => {
    it("allows npm install", () => {
      expect(isCommandAllowed("npm install")).toBe(true);
    });

    it("allows pnpm install", () => {
      expect(isCommandAllowed("pnpm install")).toBe(true);
    });

    it("rejects arbitrary commands", () => {
      expect(isCommandAllowed("rm -rf /")).toBe(false);
      expect(isCommandAllowed("curl evil.com")).toBe(false);
    });

    it("rejects empty/null", () => {
      expect(isCommandAllowed("")).toBe(false);
      expect(isCommandAllowed(null)).toBe(false);
    });
  });

  describe("run_command", () => {
    it("executes allowed command", async () => {
      execSync.mockReturnValue("added 42 packages");
      const result = await executeAction({
        type: "run_command",
        params: { cmd: "npm install" }
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("42 packages");
    });

    it("rejects disallowed command", async () => {
      const result = await executeAction({
        type: "run_command",
        params: { cmd: "rm -rf /" }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not in allow-list");
    });

    it("handles command failure", async () => {
      execSync.mockImplementation(() => { throw new Error("install failed"); });
      const result = await executeAction({
        type: "run_command",
        params: { cmd: "npm install" }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("install failed");
    });
  });

  describe("create_file", () => {
    it("creates a new file", async () => {
      const result = await executeAction({
        type: "create_file",
        params: { filePath: "test.txt", content: "hello", cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
      const content = await fs.readFile(path.join(tmpDir, "test.txt"), "utf8");
      expect(content).toBe("hello");
    });

    it("does not overwrite existing files by default", async () => {
      await fs.writeFile(path.join(tmpDir, "exists.txt"), "original");
      const result = await executeAction({
        type: "create_file",
        params: { filePath: "exists.txt", content: "new", cwd: tmpDir }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("rejects path traversal", async () => {
      const result = await executeAction({
        type: "create_file",
        params: { filePath: "../outside.txt", content: "x", cwd: tmpDir }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("traversal");
    });

    it("creates parent directories", async () => {
      const result = await executeAction({
        type: "create_file",
        params: { filePath: "nested/dir/file.txt", content: "x", cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("update_gitignore", () => {
    it("creates .gitignore with entries", async () => {
      const result = await executeAction({
        type: "update_gitignore",
        params: { entries: ["node_modules/", "dist/"], cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
      const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf8");
      expect(content).toContain("node_modules/");
      expect(content).toContain("dist/");
    });

    it("skips duplicates", async () => {
      await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      const result = await executeAction({
        type: "update_gitignore",
        params: { entries: ["node_modules/"], cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("already present");
    });

    it("appends missing entries", async () => {
      await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      const result = await executeAction({
        type: "update_gitignore",
        params: { entries: ["node_modules/", "dist/"], cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("dist/");
    });

    it("rejects empty entries", async () => {
      const result = await executeAction({
        type: "update_gitignore",
        params: { entries: [], cwd: tmpDir }
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("git_add", () => {
    it("stages files", async () => {
      execSync.mockReturnValue("");
      const result = await executeAction({
        type: "git_add",
        params: { files: ["src/a.js", "tests/a.test.js"], cwd: tmpDir }
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("2 file(s)");
    });

    it("rejects path traversal", async () => {
      const result = await executeAction({
        type: "git_add",
        params: { files: ["../evil"], cwd: tmpDir }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Invalid file path");
    });

    it("rejects shell metacharacters", async () => {
      const result = await executeAction({
        type: "git_add",
        params: { files: ["file; rm -rf /"], cwd: tmpDir }
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("executeActions", () => {
    it("executes multiple actions in sequence", async () => {
      execSync.mockReturnValue("");
      const results = await executeActions([
        { type: "update_gitignore", params: { entries: ["a/"], cwd: tmpDir } },
        { type: "update_gitignore", params: { entries: ["b/"], cwd: tmpDir } }
      ], { cwd: tmpDir });
      expect(results).toHaveLength(2);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(true);
    });

    it("stops on first failure by default", async () => {
      const results = await executeActions([
        { type: "run_command", params: { cmd: "rm -rf /" } },
        { type: "update_gitignore", params: { entries: ["x/"], cwd: tmpDir } }
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(false);
    });

    it("continues on error when continueOnError=true", async () => {
      const results = await executeActions([
        { type: "run_command", params: { cmd: "rm -rf /" } },
        { type: "update_gitignore", params: { entries: ["x/"], cwd: tmpDir } }
      ], { continueOnError: true });
      expect(results).toHaveLength(2);
    });
  });

  describe("getAllowedActionTypes", () => {
    it("returns the list of action types", () => {
      const types = getAllowedActionTypes();
      expect(types).toContain("run_command");
      expect(types).toContain("create_file");
      expect(types).toContain("update_gitignore");
      expect(types).toContain("git_add");
    });
  });

  describe("unknown action", () => {
    it("rejects unknown action type", async () => {
      const result = await executeAction({ type: "unknown_type", params: {} });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown action type");
    });

    it("rejects null/invalid", async () => {
      const result = await executeAction(null);
      expect(result.ok).toBe(false);
    });
  });
});
