// HU-3278: a seeded lane catches its index up with main in the background, under the machine-wide lease.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startDeltaIndex, readBootstrap } from "../../src/rag/bootstrap-index.js";
import { catchUpLine } from "../../src/rag/lane-catchup.js";

let root;
let lease;
const spawnFn = vi.fn(() => ({ pid: process.pid, unref: vi.fn() }));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-catchup-"));
  lease = join(root, "locks", "rag-index.json");
  spawnFn.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("startDeltaIndex", () => {
  it("spawns kj rag index --since auto detached, with the deadline, and takes the machine lease", () => {
    const now = Date.now();
    expect(startDeltaIndex(root, { spawnFn, bin: "/kj/bin/kj.js", lease, now })).toEqual({ started: true, pid: process.pid });
    const [, args, opts] = spawnFn.mock.calls[0];
    expect(args).toEqual(["/kj/bin/kj.js", "rag", "index", "--since", "auto"]);
    expect(opts).toMatchObject({ cwd: root, detached: true, stdio: "ignore" });
    expect(Number(opts.env.KJ_RAG_DEADLINE)).toBeGreaterThan(now);
    expect(readBootstrap(root)).toMatchObject({ pid: process.pid, running: true });
  });

  it("a second claimant of the machine lease is told busy and spawns nothing", () => {
    const other = mkdtempSync(join(tmpdir(), "kj-catchup-other-"));
    try {
      const holder = { pid: process.ppid, unref: vi.fn() }; // a live pid of this user that is not ours
      expect(startDeltaIndex(root, { spawnFn: () => holder, lease }).started).toBe(true);
      expect(startDeltaIndex(other, { spawnFn, lease })).toMatchObject({ started: false, busy: { pid: process.ppid } });
      expect(spawnFn).not.toHaveBeenCalled();
    } finally { rmSync(other, { recursive: true, force: true }); }
  });
});

describe("catchUpLine", () => {
  const seed = { seeded: true, chunks: 12, commit: "deadbeefcafebabe" };
  const seededLine = "rag: index seeded from main (12 chunks @ deadbee)";
  const git = (out) => vi.fn(async (args) => ({ stdout: args[0] === "rev-list" ? "3\n" : out }));

  it("a seed N commits behind starts the delta once and states its commits and files", async () => {
    const start = vi.fn(() => ({ started: true, pid: 7 }));
    const line = await catchUpLine({ laneDir: root, seed, git: git("a.js\nb.js\n"), start });
    expect(start).toHaveBeenCalledTimes(1);
    expect(line).toBe(`${seededLine}; catching up 3 commits and 2 files in the background`);
  });

  it("a seed already at HEAD starts nothing", async () => {
    const start = vi.fn();
    const line = await catchUpLine({ laneDir: root, seed, git: vi.fn(async () => ({ stdout: "0\n" })), start });
    expect(start).not.toHaveBeenCalled();
    expect(line).toBe(seededLine);
  });

  it("without a seed nothing starts and the not-seeded line is printed", async () => {
    const start = vi.fn();
    const line = await catchUpLine({ laneDir: root, seed: { seeded: false, reason: "no-main-index" }, git: git(""), start });
    expect(start).not.toHaveBeenCalled();
    expect(line).toBe("rag: not seeded (no-main-index) — the first query indexes this lane in the background");
  });

  it("says why the delta did not start when another indexer holds the lease", async () => {
    const line = await catchUpLine({ laneDir: root, seed, git: git("a.js\n"), start: () => ({ started: false, busy: {} }) });
    expect(line).toBe(`${seededLine}; catch-up of 3 commits and 1 file not started (another indexer is running); kj rag index --since auto catches up`);
  });
});
