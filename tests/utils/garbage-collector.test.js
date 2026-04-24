import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  runManualGC, runAutoGC, summarizeGC,
} from "../../src/utils/garbage-collector.js";

const DAY = 24 * 60 * 60 * 1000;

let tmpKj;
let tmpKarajan;
let savedKJ;
let savedKARAJAN;

async function mkdirp(p) { await fs.mkdir(p, { recursive: true }); }

async function writePlan(projectSlug, planId, { status = "draft", mtime, projectDir } = {}) {
  const dir = path.join(tmpKj, "plans", projectSlug);
  await mkdirp(dir);
  const filePath = path.join(dir, `${planId}.json`);
  const payload = { planId, status, version: 2 };
  if (projectDir !== undefined) payload.projectDir = projectDir;
  await fs.writeFile(filePath, JSON.stringify(payload));
  if (mtime) await fs.utimes(filePath, mtime, mtime);
  return filePath;
}

async function writeSession(id, { status = "approved", mtime } = {}) {
  const dir = path.join(tmpKarajan, "sessions", id);
  await mkdirp(dir);
  const file = path.join(dir, "session.json");
  await fs.writeFile(file, JSON.stringify({ id, status }));
  if (mtime) {
    await fs.utimes(file, mtime, mtime);
    await fs.utimes(dir, mtime, mtime);
  }
  return dir;
}

async function writeHuBatch(id, { mtime } = {}) {
  const dir = path.join(tmpKarajan, "hu-stories", id);
  await mkdirp(dir);
  const file = path.join(dir, "batch.json");
  await fs.writeFile(file, JSON.stringify({ session_id: id }));
  if (mtime) {
    await fs.utimes(file, mtime, mtime);
    await fs.utimes(dir, mtime, mtime);
  }
  return dir;
}

beforeEach(async () => {
  tmpKj = await fs.mkdtemp(path.join(os.tmpdir(), "kj-gc-"));
  tmpKarajan = await fs.mkdtemp(path.join(os.tmpdir(), "karajan-gc-"));
  savedKJ = process.env.KJ_HOME;
  savedKARAJAN = process.env.KARAJAN_HOME;
  process.env.KJ_HOME = tmpKj;
  process.env.KARAJAN_HOME = tmpKarajan;
});

afterEach(async () => {
  if (savedKJ === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = savedKJ;
  if (savedKARAJAN === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = savedKARAJAN;
  await fs.rm(tmpKj, { recursive: true, force: true });
  await fs.rm(tmpKarajan, { recursive: true, force: true });
});

describe("garbage-collector — plans", () => {
  it("removes plans whose stamped projectDir no longer exists (orphans)", async () => {
    const orphanPlan = await writePlan("x", "plan-orphan", {
      projectDir: "/definitely/does/not/exist/anywhere",
    });
    const keptPlan = await writePlan("tmp", "plan-alive", {
      projectDir: "/tmp",
    });

    const result = await runManualGC({ dryRun: false });

    const removedPaths = result.removed.map((r) => r.path);
    expect(removedPaths).toContain(orphanPlan);
    expect(removedPaths).not.toContain(keptPlan);
  });

  it("does NOT treat legacy plans without projectDir as orphans (conservative)", async () => {
    // Pre-TSK-0341 plans don't stamp projectDir. GC must fall back to
    // age-only retention instead of deleting them as "orphans".
    const legacy = await writePlan("whatever", "plan-legacy", {
      status: "draft",
      // mtime is "now" so draftRetentionDays (60d) doesn't kick in.
    });

    const result = await runManualGC({ dryRun: false });

    expect(result.removed.map((r) => r.path)).not.toContain(legacy);
    const stat = await fs.stat(legacy);
    expect(stat.isFile()).toBe(true);
  });

  it("removes finalised plans older than planRetentionDays", async () => {
    const oldApproved = await writePlan("tmp", "plan-old", {
      status: "approved",
      mtime: new Date(Date.now() - 40 * DAY),
    });
    const youngApproved = await writePlan("tmp", "plan-recent", {
      status: "approved",
      mtime: new Date(Date.now() - 5 * DAY),
    });

    const result = await runManualGC({ planRetentionDays: 30, dryRun: false });

    const paths = result.removed.map((r) => r.path);
    expect(paths).toContain(oldApproved);
    expect(paths).not.toContain(youngApproved);
  });

  it("removes stale drafts past draftRetentionDays", async () => {
    const stale = await writePlan("tmp", "plan-stale-draft", {
      status: "draft",
      mtime: new Date(Date.now() - 90 * DAY),
    });
    const fresh = await writePlan("tmp", "plan-fresh-draft", {
      status: "draft",
      mtime: new Date(Date.now() - 10 * DAY),
    });

    const result = await runManualGC({ draftRetentionDays: 60, dryRun: false });

    const paths = result.removed.map((r) => r.path);
    expect(paths).toContain(stale);
    expect(paths).not.toContain(fresh);
  });

  it("dry-run reports what would be removed but doesn't touch disk", async () => {
    const orphan = await writePlan("x", "plan-to-keep-on-disk", {
      projectDir: "/definitely/does/not/exist",
    });

    const result = await runManualGC({ dryRun: true });

    expect(result.removed.some((r) => r.path === orphan)).toBe(true);
    // File still there.
    const stat = await fs.stat(orphan);
    expect(stat.isFile()).toBe(true);
  });
});

describe("garbage-collector — sessions", () => {
  it("removes finalised sessions older than sessionRetentionDays", async () => {
    const oldApproved = await writeSession("sess-old", {
      status: "approved",
      mtime: new Date(Date.now() - 20 * DAY),
    });
    const recentApproved = await writeSession("sess-recent", {
      status: "approved",
      mtime: new Date(Date.now() - 2 * DAY),
    });
    const runningNotFinal = await writeSession("sess-running", {
      status: "running",
      mtime: new Date(Date.now() - 100 * DAY),
    });

    const result = await runManualGC({ sessionRetentionDays: 7, dryRun: false });

    const paths = result.removed.map((r) => r.path);
    expect(paths).toContain(oldApproved);
    expect(paths).not.toContain(recentApproved);
    // Running is never touched, no matter how old.
    expect(paths).not.toContain(runningNotFinal);
  });
});

describe("garbage-collector — HU story batches", () => {
  it("removes HU batches older than huRetentionDays", async () => {
    const oldBatch = await writeHuBatch("batch-old", {
      mtime: new Date(Date.now() - 30 * DAY),
    });
    const recentBatch = await writeHuBatch("batch-recent", {
      mtime: new Date(Date.now() - 5 * DAY),
    });

    const result = await runManualGC({ huRetentionDays: 14, dryRun: false });

    const paths = result.removed.map((r) => r.path);
    expect(paths).toContain(oldBatch);
    expect(paths).not.toContain(recentBatch);
  });
});

describe("garbage-collector — summary + autoGC", () => {
  it("runAutoGC is runManualGC with dryRun=false", async () => {
    const orphan = await writePlan("x", "plan-auto", {
      projectDir: "/definitely/does/not/exist",
    });

    const result = await runAutoGC();

    expect(result.removed.some((r) => r.path === orphan)).toBe(true);
    await expect(fs.stat(orphan)).rejects.toThrow();
  });

  it("summarizeGC returns null when nothing was removed", () => {
    expect(summarizeGC({ removed: [], bytesFreed: 0, errors: [] })).toBeNull();
  });

  it("summarizeGC groups by kind and reports kib when bytes>0", () => {
    const line = summarizeGC({
      removed: [
        { kind: "plan", bytes: 2048 },
        { kind: "plan", bytes: 1024 },
        { kind: "session" },
      ],
      bytesFreed: 3072,
      errors: [],
    });
    expect(line).toContain("2 plans");
    expect(line).toContain("1 session");
    expect(line).toMatch(/\d+ KiB/);
  });

  it("never throws on missing ~/.kj/ or ~/.karajan/", async () => {
    await fs.rm(tmpKj, { recursive: true, force: true });
    await fs.rm(tmpKarajan, { recursive: true, force: true });

    const result = await runManualGC({ dryRun: false });

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
