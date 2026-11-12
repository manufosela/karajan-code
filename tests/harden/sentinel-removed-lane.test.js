// HU-4112: a lane removed with `kj worktree done --force` no longer exists on disk, so the
// Stop gate must not hold the turn for work recorded in it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { laneViolations } from "../../src/harden/sentinel/sentinel-lib.mjs";

const rec = { edited_sources: ["src/a.js"], edited_tests: [] };

describe("laneViolations — removed lanes", () => {
  it("ignores a lane whose directory is gone", () => {
    expect(laneViolations({ lanes: { "/nonexistent/kj-removed-lane": rec } })).toEqual([]);
  });

  it("still judges a lane that exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-"));
    try {
      spawnSync("git", ["init", "-q", dir]);
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src/a.js"), "export const a = 1;\n");
      expect(laneViolations({ lanes: { [dir]: rec } }).length).toBeGreaterThan(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
