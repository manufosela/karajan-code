import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn()
  }
}));

describe("utils/fs", () => {
  let ensureDir, exists, resolveFromCwd, fsMock;

  beforeEach(async () => {
    vi.resetAllMocks();
    fsMock = (await import("node:fs/promises")).default;
    const mod = await import("../src/utils/fs.js");
    ensureDir = mod.ensureDir;
    exists = mod.exists;
    resolveFromCwd = mod.resolveFromCwd;
  });

  describe("ensureDir", () => {
    it("calls fs.mkdir with recursive: true", async () => {
      await ensureDir("/some/dir");
      expect(fsMock.mkdir).toHaveBeenCalledWith("/some/dir", { recursive: true });
    });
  });

  describe("exists", () => {
    it("returns true when file is accessible", async () => {
      fsMock.access.mockResolvedValue(undefined);
      expect(await exists("/some/file")).toBe(true);
    });

    it("returns false when access throws", async () => {
      fsMock.access.mockRejectedValue(new Error("ENOENT"));
      expect(await exists("/missing/file")).toBe(false);
    });
  });

  describe("resolveFromCwd", () => {
    it("resolves relative path from cwd", () => {
      const result = resolveFromCwd("src", "index.js");
      expect(result).toBe(path.resolve(process.cwd(), "src", "index.js"));
    });

    it("returns absolute path for absolute input", () => {
      const result = resolveFromCwd("/abs/path");
      expect(result).toBe("/abs/path");
    });
  });
});
