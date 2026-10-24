// KJC-TSK-1174 (RAG-A2): a project with no index gets one in the background, once; the session
// never waits for it, and a dead attempt is not retried on every command.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { dbPath: null };
vi.mock("../../src/rag/project-store.js", () => ({ openProjectStore: vi.fn(() => ({ close: vi.fn() })), projectDbPath: vi.fn(() => state.dbPath) }));
vi.mock("../../src/rag/vec-store.js", () => ({ projectSlug: vi.fn(() => "p"), getLastIndexedCommit: vi.fn(() => null), setLastIndexedCommit: vi.fn() }));
vi.mock("../../src/rag/indexer.js", () => ({ indexProject: vi.fn(), indexProjectDelta: vi.fn() }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({})) }));
vi.mock("../../src/rag/embed-schema.js", () => ({ readEmbedSchema: vi.fn(() => 99) }));
vi.mock("../../src/rag/bootstrap-index.js", async () => {
  const real = await vi.importActual("../../src/rag/bootstrap-index.js");
  return { ...real, startBootstrap: vi.fn(real.startBootstrap) };
});

const { startBootstrap, readBootstrap, RETRY_MS, GRACE_MS, MAX_RUN_MS } = await import("../../src/rag/bootstrap-index.js");
const { maybeAutoUpdate } = await import("../../src/rag/auto-update.js");

let root;
const spawned = [];
const spawnFn = vi.fn((cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: process.pid, unref: vi.fn() }; });
const warned = [];
const logger = { info: vi.fn(), warn: (l) => warned.push(l) };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-rag-bootstrap-"));
  state.dbPath = join(root, ".karajan", "rag.db");
  spawned.length = 0; warned.length = 0;
  vi.clearAllMocks();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("startBootstrap", () => {
  it("spawns kj rag index --with-sources detached, once, and notes the pid next to the store", () => {
    expect(startBootstrap(root, { spawnFn, bin: "/kj/bin/kj.js" })).toEqual({ started: true, pid: process.pid });
    expect(spawned[0].args).toEqual(["/kj/bin/kj.js", "rag", "index", "--with-sources"]);
    expect(spawned[0].opts).toMatchObject({ cwd: root, detached: true, stdio: "ignore" });
    expect(readBootstrap(root)).toMatchObject({ pid: process.pid, running: true });
    expect(startBootstrap(root, { spawnFn })).toEqual({ started: false, pid: process.pid });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(readBootstrap(root, { now: Date.now() + MAX_RUN_MS }).running).toBe(false); // a pid outlived is a reused pid
  });

  it("a second caller arriving during the spawn finds the claim and does not spawn again", () => {
    let inner;
    const racing = vi.fn(() => { inner = startBootstrap(root, { spawnFn }); return { pid: process.pid, unref: vi.fn() }; });
    expect(startBootstrap(root, { spawnFn: racing })).toEqual({ started: true, pid: process.pid });
    expect(inner).toEqual({ started: false, pid: process.pid });
  });

  it("a marker caught half-written counts as running, so nobody spawns over it", () => {
    mkdirSync(join(root, ".karajan"), { recursive: true });
    writeFileSync(`${state.dbPath}.bootstrap`, "{\"pid\": 12", "utf8");
    expect(readBootstrap(root)).toMatchObject({ running: true });
    expect(startBootstrap(root, { spawnFn })).toEqual({ started: false, pid: null });
    expect(spawnFn).not.toHaveBeenCalled();
    // KJC-BUG-0396: a second of slack, the marker's mtime (nanoseconds) can sit a fraction of a
    // millisecond ahead of Date.now() on CI runners, which kept the grace open by exactly that.
    expect(startBootstrap(root, { spawnFn, now: Date.now() + GRACE_MS + 1000 })).toEqual({ started: true, pid: process.pid });
  });

  it("a lock held by another command yields; a lock left by a crashed one is taken over", () => {
    const lock = `${state.dbPath}.bootstrap.lock`;
    mkdirSync(lock, { recursive: true });
    expect(startBootstrap(root, { spawnFn })).toEqual({ started: false, pid: null });
    utimesSync(lock, 1, 1); // left long ago
    expect(startBootstrap(root, { spawnFn })).toEqual({ started: true, pid: process.pid });
  });

  it("an attempt that died is retried only after RETRY_MS", () => {
    const dead = vi.fn(() => ({ pid: 2 ** 22 - 1, unref: vi.fn() }));
    const t0 = 1_000_000;
    expect(startBootstrap(root, { spawnFn: dead, now: t0 })).toMatchObject({ started: true });
    expect(startBootstrap(root, { spawnFn: dead, now: t0 + RETRY_MS - 1 })).toEqual({ started: false, recent: true, pid: null });
    expect(startBootstrap(root, { spawnFn: dead, now: t0 + RETRY_MS })).toMatchObject({ started: true });
  });
});

describe("maybeAutoUpdate without an index", () => {
  beforeEach(() => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: root });
  });

  it("starts the bootstrap, says so once, and the query goes on without waiting", async () => {
    startBootstrap.mockReturnValue({ started: true, pid: 4242 });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ skipped: true, reason: "bootstrapping", pid: 4242 });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ skipped: true, reason: "bootstrapping" });
    expect(warned.filter((l) => /indexing it in the background/.test(l))).toHaveLength(1);
  });

  it("a recent dead attempt is not retried: the index is asked for by hand, once", async () => {
    startBootstrap.mockReturnValue({ started: false, recent: true, pid: null });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ skipped: true, reason: "bootstrap-failed" });
    await maybeAutoUpdate({ projectDir: root, config: {}, logger });
    expect(warned.filter((l) => /kj rag index --with-sources/.test(l))).toHaveLength(1);
  });
});
