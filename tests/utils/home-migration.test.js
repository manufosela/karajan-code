// Tests for ~/.kj/ → ~/.karajan/ migrator (PR 2 of KJC-PCS-0047). Each
// test sets KJ_HOME + KARAJAN_HOME to tmp dirs and passes `force:true`
// to bypass the migrator's own VITEST guard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migrateKjToKarajan } from "../../src/utils/home-migration.js";

let src, dst, savedKJ, savedK, warnSpy;
async function w(p, c = "{}") { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, c); }

beforeEach(async () => {
  src = await fs.mkdtemp(path.join(os.tmpdir(), "kj-migr-src-"));
  dst = await fs.mkdtemp(path.join(os.tmpdir(), "kj-migr-dst-"));
  savedKJ = process.env.KJ_HOME; savedK = process.env.KARAJAN_HOME;
  process.env.KJ_HOME = src; process.env.KARAJAN_HOME = dst;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  if (savedKJ === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = savedKJ;
  if (savedK === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = savedK;
  await fs.rm(src, { recursive: true, force: true });
  await fs.rm(dst, { recursive: true, force: true });
  warnSpy.mockRestore();
});

describe("migrateKjToKarajan", () => {
  it("no-ops on source-empty / source-missing / same-path", async () => {
    expect((await migrateKjToKarajan({ force: true })).reason).toBe("source-empty");
    await fs.rm(src, { recursive: true, force: true });
    expect((await migrateKjToKarajan({ force: true })).reason).toBe("source-missing");
    src = await fs.mkdtemp(path.join(os.tmpdir(), "kj-migr-src-"));
    process.env.KJ_HOME = process.env.KARAJAN_HOME;
    expect((await migrateKjToKarajan({ force: true })).reason).toBe("same-path");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("moves plans/, standby/, worktrees/ + writes marker + tarball backup + one stderr line", async () => {
    await w(path.join(src, "plans", "slug-a", "p1.json"), '{"planId":"p1"}');
    await w(path.join(src, "standby", "s1.json"));
    await w(path.join(src, "worktrees", "wt1", "marker"), "x");

    const r = await migrateKjToKarajan({ force: true });
    expect(r.migrated).toBe(true);
    expect(r.counts).toEqual({ plans: 1, standby: 1, worktrees: 1, runs: 0 });
    await expect(fs.readFile(path.join(dst, "plans", "slug-a", "p1.json"), "utf8")).resolves.toContain("p1");

    const marker = JSON.parse(await fs.readFile(path.join(dst, ".kj-migrated.json"), "utf8"));
    expect(marker.version).toBe(1);
    expect(marker.source_dir).toBe(src);
    expect(marker.backup_path).toMatch(/kj-pre-migration-.*\.tar\.gz$/);
    expect((await fs.stat(r.backupPath)).size).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/Migrated.*plans.*backup:/);
  });

  it("is idempotent — second run with new content is a no-op", async () => {
    await w(path.join(src, "plans", "a", "p1.json"));
    await migrateKjToKarajan({ force: true });
    await w(path.join(src, "plans", "b", "p2.json"));
    const second = await migrateKjToKarajan({ force: true });
    expect(second.reason).toBe("already-migrated");
    await expect(fs.access(path.join(src, "plans", "b", "p2.json"))).resolves.toBeUndefined();
  });

  it("merges runs/ with .karajan/ winning on conflict", async () => {
    await w(path.join(src, "runs", "shared.json"), '{"src":true}');
    await w(path.join(src, "runs", "only-src.json"));
    await w(path.join(dst, "runs", "shared.json"), '{"dst":true}');
    const r = await migrateKjToKarajan({ force: true });
    expect(r.counts.runs).toBe(1);
    expect(JSON.parse(await fs.readFile(path.join(dst, "runs", "shared.json"), "utf8")).dst).toBe(true);
    await expect(fs.access(path.join(dst, "runs", "only-src.json"))).resolves.toBeUndefined();
  });

  it("dryRun leaves source and target untouched", async () => {
    await w(path.join(src, "plans", "a", "p1.json"));
    const r = await migrateKjToKarajan({ force: true, dryRun: true });
    expect(r.reason).toBe("dry-run");
    await expect(fs.access(path.join(src, "plans", "a", "p1.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dst, ".kj-migrated.json"))).rejects.toThrow();
  });
});
