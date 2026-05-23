import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { handleClean } from "../../src/mcp/handlers/management-handlers.js";

// PR 1 of ~/.kj/ → ~/.karajan/ consolidation: KARAJAN_HOME (or the
// deprecated KJ_HOME) now resolves to a SINGLE root containing every
// Karajan subdir, so the test only needs one tmp dir for plans/
// sessions/ hu-board.db. Aliases `tmpKj` / `tmpKarajan` kept for
// minimal diff against the rest of the test body.
let tmpRoot;
let tmpKj;
let tmpKarajan;
let saved;

async function write(p, content = "x") {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "karajan-mcp-clean-"));
  tmpKj = tmpRoot;
  tmpKarajan = tmpRoot;
  saved = { KJ: process.env.KJ_HOME, KARAJAN: process.env.KARAJAN_HOME };
  delete process.env.KJ_HOME;
  process.env.KARAJAN_HOME = tmpRoot;
});

afterEach(async () => {
  if (saved.KJ === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = saved.KJ;
  if (saved.KARAJAN === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = saved.KARAJAN;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("MCP handleClean", () => {
  it("defaults to dry-run (returns items without deleting anything)", async () => {
    const planFile = path.join(tmpKj, "plans", "x", "plan-orphan.json");
    await write(planFile, JSON.stringify({
      planId: "plan-orphan",
      version: 2,
      status: "draft",
      projectDir: "/definitely/does/not/exist",
    }));

    const result = await handleClean({});

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.items[0].path).toBe(planFile);
    // File still on disk because dryRun.
    const stat = await fs.stat(planFile);
    expect(stat.isFile()).toBe(true);
  });

  it("yes=true actually deletes", async () => {
    const planFile = path.join(tmpKj, "plans", "x", "plan-orphan.json");
    await write(planFile, JSON.stringify({
      planId: "plan-orphan",
      version: 2,
      status: "draft",
      projectDir: "/definitely/does/not/exist",
    }));

    const result = await handleClean({ yes: true });

    expect(result.dryRun).toBe(false);
    expect(result.removed).toBe(1);
    await expect(fs.stat(planFile)).rejects.toThrow();
  });

  it("nuke=true drops the HU board DB in addition to retention=0 sweeps", async () => {
    await write(path.join(tmpKarajan, "hu-board.db"), "fake");
    await write(path.join(tmpKarajan, "hu-board.db-wal"), "fake");

    const result = await handleClean({ yes: true, nuke: true });

    expect(result.nuke).toBe(true);
    expect(result.removed).toBeGreaterThanOrEqual(2);
    await expect(fs.stat(path.join(tmpKarajan, "hu-board.db"))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpKarajan, "hu-board.db-wal"))).rejects.toThrow();
  });

  it("returns a tidy summary when nothing to clean", async () => {
    const result = await handleClean({});
    expect(result.removed).toBe(0);
    expect(result.summary).toMatch(/tidy/);
  });

  it("exposes a per-kind breakdown for MCP client rendering", async () => {
    const p1 = path.join(tmpKj, "plans", "a", "plan-1.json");
    const p2 = path.join(tmpKj, "plans", "b", "plan-2.json");
    await write(p1, JSON.stringify({ planId: "p1", version: 2, projectDir: "/nope-1" }));
    await write(p2, JSON.stringify({ planId: "p2", version: 2, projectDir: "/nope-2" }));

    const result = await handleClean({ yes: true });

    expect(result.breakdown).toEqual({ plan: 2 });
    expect(result.bytesFreed).toBeGreaterThan(0);
  });
});
