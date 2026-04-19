import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

describe("session/journal/tree-writer", () => {
  let parseNameStatus, buildTree, renderTree, collectAffectedFiles, writeTreeJournal;
  let runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ parseNameStatus, buildTree, renderTree, collectAffectedFiles, writeTreeJournal } =
      await import("../../src/session/journal/tree-writer.js"));
    ({ runCommand } = await import("../../src/utils/process.js"));
  });

  describe("parseNameStatus", () => {
    it("parses simple MAD entries", () => {
      const raw = "M\tsrc/a.js\nA\tsrc/b.js\nD\told.js";
      const entries = parseNameStatus(raw);
      expect(entries).toEqual([
        { file: "src/a.js", status: "modified" },
        { file: "src/b.js", status: "added" },
        { file: "old.js", status: "deleted" },
      ]);
    });

    it("parses rename entries using the new name (third column)", () => {
      const raw = "R100\tsrc/old.js\tsrc/new.js";
      const entries = parseNameStatus(raw);
      expect(entries).toEqual([{ file: "src/new.js", status: "renamed" }]);
    });

    it("returns [] for empty input", () => {
      expect(parseNameStatus("")).toEqual([]);
      expect(parseNameStatus(null)).toEqual([]);
      expect(parseNameStatus("   \n\n")).toEqual([]);
    });

    it("labels unknown status codes as 'other'", () => {
      const entries = parseNameStatus("X\tfoo.js");
      expect(entries).toEqual([{ file: "foo.js", status: "other" }]);
    });

    it("skips malformed lines", () => {
      const raw = "M\nA\tgood.js\n\tno-status.js";
      const entries = parseNameStatus(raw);
      expect(entries).toEqual([{ file: "good.js", status: "added" }]);
    });
  });

  describe("buildTree", () => {
    it("groups files under nested directories", () => {
      const tree = buildTree([
        { file: "src/a.js", status: "modified" },
        { file: "src/utils/b.js", status: "added" },
        { file: "root.md", status: "modified" },
      ]);
      expect(tree.files).toEqual([{ file: "root.md", status: "modified" }]);
      expect(tree.children.has("src")).toBe(true);
      const srcNode = tree.children.get("src");
      expect(srcNode.files).toEqual([{ file: "a.js", status: "modified" }]);
      expect(srcNode.children.has("utils")).toBe(true);
      expect(srcNode.children.get("utils").files).toEqual([{ file: "b.js", status: "added" }]);
    });
  });

  describe("renderTree", () => {
    it("returns null for empty list", () => {
      expect(renderTree([])).toBeNull();
      expect(renderTree(null)).toBeNull();
    });

    it("renders directories before files, both sorted alphabetically", () => {
      const out = renderTree([
        { file: "src/b.js", status: "modified" },
        { file: "src/a.js", status: "added" },
        { file: "README.md", status: "modified" },
        { file: "tests/x.test.js", status: "added" },
      ]);
      const body = out.split("\n");
      // Directories appear first at each level, then root-level files.
      const srcIdx = body.findIndex((l) => l.trim() === "src/");
      const testsIdx = body.findIndex((l) => l.trim() === "tests/");
      const readmeIdx = body.findIndex((l) => l.includes("README.md"));
      expect(srcIdx).toBeGreaterThan(-1);
      expect(testsIdx).toBeGreaterThan(-1);
      expect(readmeIdx).toBeGreaterThan(Math.max(srcIdx, testsIdx));
      // Files within src/ are alphabetically sorted (case-insensitive).
      expect(out.indexOf("a.js")).toBeLessThan(out.indexOf("b.js"));
    });

    it("appends a summary counts line at the bottom", () => {
      const out = renderTree([
        { file: "a.js", status: "added" },
        { file: "b.js", status: "added" },
        { file: "c.js", status: "deleted" },
      ]);
      expect(out).toMatch(/Total: 3 files/);
      expect(out).toContain("2 added");
      expect(out).toContain("1 deleted");
    });

    it("uses singular 'file' when only one entry", () => {
      const out = renderTree([{ file: "a.js", status: "modified" }]);
      expect(out).toContain("Total: 1 file");
    });

    it("indents nested directories with 2 spaces per depth", () => {
      const out = renderTree([{ file: "a/b/c.js", status: "modified" }]);
      const lines = out.split("\n");
      expect(lines.some((l) => l === "a/")).toBe(true);
      expect(lines.some((l) => l === "  b/")).toBe(true);
      expect(lines.some((l) => l === "    c.js [modified]")).toBe(true);
    });
  });

  describe("collectAffectedFiles", () => {
    it("runs `git diff --name-status <baseRef>...HEAD` and returns parsed entries", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "M\tsrc/a.js\nA\tb.md", stderr: "" });
      const entries = await collectAffectedFiles("abc123");
      expect(runCommand).toHaveBeenCalledWith("git", ["diff", "--name-status", "abc123...HEAD"]);
      expect(entries).toHaveLength(2);
    });

    it("returns [] when git exits non-zero", async () => {
      runCommand.mockResolvedValue({ exitCode: 128, stdout: "", stderr: "bad ref" });
      const entries = await collectAffectedFiles("bad");
      expect(entries).toEqual([]);
    });

    it("returns [] when runCommand throws", async () => {
      runCommand.mockRejectedValue(new Error("git missing"));
      const entries = await collectAffectedFiles("abc");
      expect(entries).toEqual([]);
    });

    it("returns [] when baseRef is falsy", async () => {
      expect(await collectAffectedFiles(null)).toEqual([]);
      expect(await collectAffectedFiles("")).toEqual([]);
      expect(runCommand).not.toHaveBeenCalled();
    });
  });

  describe("writeTreeJournal", () => {
    const cleanups = [];

    afterEach(async () => {
      for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
      cleanups.length = 0;
    });

    it("writes tree.txt when there are affected files", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tree-"));
      cleanups.push(tmp);
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "M\tsrc/a.js\nA\tsrc/utils/b.js", stderr: "" });
      const result = await writeTreeJournal(tmp, "abc123");
      expect(result.written).toBe(true);
      const content = await fs.readFile(result.path, "utf8");
      expect(content).toContain("src/");
      expect(content).toContain("utils/");
      expect(content).toContain("a.js [modified]");
      expect(content).toContain("b.js [added]");
      expect(content).toContain("Total: 2 files");
    });

    it("returns { written:false, path:null } when no diff entries", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
      const result = await writeTreeJournal("/nowhere", "abc");
      expect(result.written).toBe(false);
      expect(result.path).toBeNull();
    });

    it("handles fs errors gracefully", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tree-ro-"));
      cleanups.push(tmp);
      await fs.writeFile(path.join(tmp, "blocker"), "file");
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "M\ta.js", stderr: "" });
      const logger = { info: () => {}, warn: () => {} };
      const result = await writeTreeJournal(path.join(tmp, "blocker", "under-file"), "abc", { logger });
      expect(result.written).toBe(false);
    });
  });
});
