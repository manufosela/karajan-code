// PAR-G (KJC-TSK-0630): a fresh lane worktree gets submodules initialized
// and dependencies installed — best-effort, never blocking the lane.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapWorktree } from "../src/hu/worktree-bootstrap.js";

const dirs = [];
function makeWorktree(files = []) {
  const dir = mkdtempSync(join(tmpdir(), "kj-wt-boot-"));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, f), "{}");
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const okRun = () => vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));

describe("bootstrapWorktree (PAR-G)", () => {
  it("initializes submodules when .gitmodules exists, with cwd=worktree", async () => {
    const wt = makeWorktree([".gitmodules"]);
    const run = okRun();
    const res = await bootstrapWorktree({ worktreePath: wt, run });
    expect(res.ok).toBe(true);
    expect(res.steps).toEqual(["submodules"]);
    expect(run).toHaveBeenCalledWith("git", ["submodule", "update", "--init", "--recursive"], expect.objectContaining({ cwd: wt }));
  });

  it("runs npm ci when package-lock.json exists and no explicit setup", async () => {
    const wt = makeWorktree(["package-lock.json"]);
    const run = okRun();
    const res = await bootstrapWorktree({ worktreePath: wt, run });
    expect(res.steps).toEqual(["deps"]);
    expect(run).toHaveBeenCalledWith("npm", ["ci", "--no-audit", "--no-fund"], expect.objectContaining({ cwd: wt }));
  });

  it("an explicit setup command wins over auto-detect", async () => {
    const wt = makeWorktree(["package-lock.json"]);
    const run = okRun();
    const res = await bootstrapWorktree({ worktreePath: wt, setupCommand: "pnpm install --frozen-lockfile", run });
    expect(res.steps).toEqual(["setup"]);
    expect(run).toHaveBeenCalledWith("sh", ["-c", "pnpm install --frozen-lockfile"], expect.objectContaining({ cwd: wt }));
  });

  it("a failing step warns but never throws — the lane continues", async () => {
    const wt = makeWorktree(["package-lock.json"]);
    const logger = { warn: vi.fn(), info: vi.fn() };
    const run = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "EACCES" }));
    const res = await bootstrapWorktree({ worktreePath: wt, logger, run });
    expect(res.ok).toBe(false);
    expect(res.warnings[0]).toContain("deps failed");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("a throwing runner is contained too", async () => {
    const wt = makeWorktree([".gitmodules"]);
    const run = vi.fn(async () => { throw new Error("spawn ENOENT"); });
    const res = await bootstrapWorktree({ worktreePath: wt, run });
    expect(res.ok).toBe(false);
    expect(res.warnings[0]).toContain("spawn ENOENT");
  });

  it("no lockfile, no submodules, no setup → no-op", async () => {
    const wt = makeWorktree();
    const run = okRun();
    const res = await bootstrapWorktree({ worktreePath: wt, run });
    expect(res.ok).toBe(true);
    expect(res.steps).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
