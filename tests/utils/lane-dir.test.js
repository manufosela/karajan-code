import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLaneDir } from "../../src/utils/lane-dir.js";

describe("resolveLaneDir", () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-"));
  fs.mkdirSync(path.join(main, ".kj", "worktrees", "hu-1-x"), { recursive: true });

  it("returns the lane directory under the main checkout", () => {
    expect(resolveLaneDir("hu-1-x", main)).toBe(path.join(main, ".kj", "worktrees", "hu-1-x"));
  });
  it("fails loudly for an unknown lane", () => {
    expect(() => resolveLaneDir("nope", main)).toThrow(/lane "nope" not found/);
  });
  it("rejects a slug that escapes the lanes dir", () => {
    expect(() => resolveLaneDir("../..", main)).toThrow(/invalid lane/);
    expect(() => resolveLaneDir("a/b", main)).toThrow(/invalid lane/);
  });
});
