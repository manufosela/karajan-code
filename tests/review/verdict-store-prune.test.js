// KJC-BUG-0173 — the verdict store (.karajan/reviews/<sha256>.json) grows
// unbounded: a verdict is keyed by one exact diff, so once that diff is
// committed or changed its hash is never checked again. pruneVerdicts is the
// opportunistic GC that sheds verdicts older than the TTL; --dry-run never deletes.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pruneVerdicts, saveVerdict } from "../../src/review/verdict-store.js";

let projectDir;
const reviewsDir = () => join(projectDir, ".karajan", "reviews");
const write = (name, ageDays) => {
  const file = join(reviewsDir(), name);
  writeFileSync(file, "{}\n");
  const t = new Date(Date.now() - ageDays * 86400000);
  utimesSync(file, t, t);
};

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "kj-prune-"));
  mkdirSync(reviewsDir(), { recursive: true });
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe("pruneVerdicts (KJC-BUG-0173)", () => {
  it("removes verdicts older than the TTL and keeps fresh ones", async () => {
    write("old1.json", 40);
    write("old2.json", 20);
    write("fresh.json", 2);
    const res = await pruneVerdicts({ projectDir, maxAgeDays: 14 });
    expect(res.removed).toBe(2);
    expect(res.scanned).toBe(3);
    expect(readdirSync(reviewsDir()).sort()).toEqual(["fresh.json"]);
  });

  it("dry-run reports what would go but deletes nothing", async () => {
    write("old.json", 30);
    write("fresh.json", 1);
    const res = await pruneVerdicts({ projectDir, maxAgeDays: 14, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.removed).toBe(0);
    expect(res.expired).toEqual(["old.json"]);
    expect(readdirSync(reviewsDir()).length).toBe(2);
  });

  it("ignores non-json files and a missing store", async () => {
    write("keep.json", 40);
    writeFileSync(join(reviewsDir(), "notes.txt"), "x");
    const res = await pruneVerdicts({ projectDir, maxAgeDays: 14 });
    expect(res.scanned).toBe(1);
    expect(res.removed).toBe(1);
    const gone = await pruneVerdicts({ projectDir: join(projectDir, "nope") });
    expect(gone).toMatchObject({ scanned: 0, removed: 0 });
  });

  it("saveVerdict opportunistically prunes stale verdicts as a side effect", async () => {
    write("ancient.json", 60);
    await saveVerdict(projectDir, "diff --git a b\n+new line\n", { verdict: "approved", reviewer: "codex" });
    const names = readdirSync(reviewsDir());
    expect(names).not.toContain("ancient.json");
    expect(names.some((n) => /^[0-9a-f]{64}\.json$/.test(n))).toBe(true);
  });
});
