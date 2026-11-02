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
  return { ...real, startBootstrap: vi.fn(real.startBootstrap), stopBootstrap: vi.fn(real.stopBootstrap) };
});
vi.mock("../../src/rag/pid-lease.js", async () => {
  const real = await vi.importActual("../../src/rag/pid-lease.js");
  return { ...real, stopLeaseHolder: vi.fn(real.stopLeaseHolder) };
});

const { startBootstrap, stopBootstrap, readBootstrap, RETRY_MS, GRACE_MS, MAX_RUN_MS } = await import("../../src/rag/bootstrap-index.js");
const { readLease, stopLeaseHolder } = await import("../../src/rag/pid-lease.js");
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

// HU-2757: one background index per machine. Another lane's indexer is a live pid that is not this one.
describe("startBootstrap machine lease", () => {
  const other = () => ({ pid: process.ppid, unref: vi.fn() });
  let lease, rootB, t0;
  const spawnOther = vi.fn(other);
  const inB = (opts) => { state.dbPath = join(rootB, ".karajan", "rag.db"); return startBootstrap(rootB, { spawnFn: spawnOther, lease, now: t0, ...opts }); };
  beforeEach(() => {
    lease = join(root, "locks", "rag-index.json");
    rootB = mkdtempSync(join(tmpdir(), "kj-rag-bootstrap-b-"));
    t0 = Date.now();
    expect(startBootstrap(root, { spawnFn: spawnOther, lease, now: t0 })).toEqual({ started: true, pid: process.ppid });
  });
  afterEach(() => rmSync(rootB, { recursive: true, force: true }));

  it("a second project finds the machine busy and spawns nothing, nor burns its RETRY_MS", () => {
    expect(inB()).toMatchObject({ started: false, busy: { pid: process.ppid, slug: "p" } });
    expect(spawnOther).toHaveBeenCalledTimes(1);
    expect(readBootstrap(rootB)).toBeNull();
  });

  it("a lease whose holder is dead is taken over", () => {
    writeFileSync(lease, JSON.stringify({ pid: 2 ** 22 - 1, at: t0, projectDir: root, slug: "p" }), "utf8");
    expect(inB()).toMatchObject({ started: true, pid: process.ppid });
  });

  it("a spawn that fails frees the lease and the marker it had taken, and says why", () => {
    rmSync(lease);
    rmSync(`${state.dbPath}.bootstrap`);
    expect(() => inB({ spawnFn: () => { throw new Error("EAGAIN"); } })).toThrow("EAGAIN");
    expect(readBootstrap(rootB)).toBeNull();
    expect(inB()).toMatchObject({ started: true });
  });

  it("a lease older than MAX_RUN_MS is taken over even when its pid is alive", () => {
    expect(inB({ now: t0 + MAX_RUN_MS })).toMatchObject({ started: true, pid: process.ppid });
  });

  it("a machine mutex held fresh yields; one left by a crashed command is taken over", () => {
    rmSync(lease);
    mkdirSync(`${lease}.lock`, { recursive: true });
    expect(inB()).toMatchObject({ started: false, busy: {} });
    utimesSync(`${lease}.lock`, 1, 1);
    expect(inB()).toMatchObject({ started: true });
  });
});

// HU-2758: an indexer past MAX_RUN_MS is stopped, verified through ps; nothing here signals a real process.
describe("stopBootstrap", () => {
  const PID = 4242;
  let lease, t0;
  const table = ({ command = readBootstrap(root).command } = {}) => {
    const calls = [];
    let dead = false;
    const kill = (pid, sig) => { calls.push([pid, sig]); if (sig === "SIGTERM") dead = true; if (sig === 0 && dead) throw new Error("ESRCH"); };
    return { calls, kill, ps: () => ({ elapsedMs: 10 * MAX_RUN_MS, command }), sleep: async () => {} };
  };
  const signals = (calls) => calls.filter(([, sig]) => sig !== 0);
  beforeEach(() => {
    lease = join(root, "locks", "rag-index.json");
    t0 = Date.now();
    startBootstrap(root, { spawnFn: () => ({ pid: PID, unref: vi.fn() }), lease, now: t0 });
  });

  it("past MAX_RUN_MS it stops the indexer, and the next start does not respawn it, even after RETRY_MS", async () => {
    const proc = table();
    const later = t0 + MAX_RUN_MS;
    expect(await stopBootstrap(root, { lease, now: later, ...proc })).toMatchObject({ pid: PID });
    expect(signals(proc.calls)).toEqual([[-PID, "SIGTERM"]]);
    expect(readBootstrap(root, { now: later })).toMatchObject({ pid: PID, stoppedAt: later, stoppedBy: "max-run", running: false });
    expect(startBootstrap(root, { spawnFn, lease, now: later + RETRY_MS + 1 })).toEqual({ started: false, recent: true, stopped: "max-run" });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("frees the lease that names the stopped pid", async () => {
    expect(await stopBootstrap(root, { lease, now: t0 + MAX_RUN_MS, ...table() })).toMatchObject({ pid: PID });
    expect(readLease(lease)).toBeNull();
  });

  it("keeps the lease when the stop could not be noted (marked: false)", async () => {
    const now = t0 + MAX_RUN_MS;
    mkdirSync(`${state.dbPath}.bootstrap.lock`); // the marker mutex stays busy: held fresh as of `now`
    utimesSync(`${state.dbPath}.bootstrap.lock`, now / 1000, now / 1000);
    expect(await stopBootstrap(root, { lease, now, wait: () => {}, ...table() })).toMatchObject({ pid: PID, marked: false });
    expect(readLease(lease)).toMatchObject({ pid: PID });
  });

  it("younger than MAX_RUN_MS it is left alone; with force it is stopped and RETRY_MS counts from stoppedAt", async () => {
    const proc = table();
    const now = t0 + 1000;
    expect(await stopBootstrap(root, { lease, now, ...proc })).toBeNull();
    expect(signals(proc.calls)).toEqual([]);
    expect(await stopBootstrap(root, { lease, now, force: true, ...proc })).toMatchObject({ pid: PID });
    expect(readBootstrap(root, { now })).toMatchObject({ stoppedBy: "lane-done" });
    expect(startBootstrap(root, { spawnFn, lease, now: now + RETRY_MS - 1 })).toEqual({ started: false, recent: true, pid: null });
    expect(startBootstrap(root, { spawnFn, lease, now: now + RETRY_MS })).toMatchObject({ started: true });
  });

  it("a reused pid gets no signal and the marker is unchanged", async () => {
    const proc = table({ command: "vim notes.md" });
    expect(await stopBootstrap(root, { lease, now: t0 + MAX_RUN_MS, ...proc })).toBeNull();
    expect(signals(proc.calls)).toEqual([]);
    expect(readBootstrap(root, { now: t0 })).toMatchObject({ pid: PID, at: t0 });
    expect(readBootstrap(root, { now: t0 })).not.toHaveProperty("stoppedAt");
  });

  it("leaves a lease that names another pid", async () => {
    writeFileSync(lease, JSON.stringify({ pid: 777, at: t0, projectDir: "/other", slug: "o" }), "utf8");
    expect(await stopBootstrap(root, { lease, now: t0 + MAX_RUN_MS, ...table() })).toMatchObject({ pid: PID });
    expect(readLease(lease)).toMatchObject({ pid: 777 });
  });
});

describe("maybeAutoUpdate without an index", () => {
  // The real stops would read this machine's lease: here they answer "nothing to stop" unless a test says otherwise.
  beforeEach(() => {
    stopBootstrap.mockResolvedValue(null);
    stopLeaseHolder.mockResolvedValue(null);
  });
  afterEach(() => { stopBootstrap.mockReset(); stopLeaseHolder.mockReset(); });
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

  it("a machine busy with another index queues this one: said once, tried again on the next command", async () => {
    startBootstrap.mockReturnValue({ started: false, busy: { slug: "other", pid: 77 } });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ skipped: true, reason: "bootstrap-queued", holder: { pid: 77 } });
    await maybeAutoUpdate({ projectDir: root, config: {}, logger });
    expect(warned.filter((l) => /another background index is running \(other, pid 77\)/.test(l))).toHaveLength(1);
  });

  it("a recent dead attempt is not retried: the index is asked for by hand, once", async () => {
    startBootstrap.mockReturnValue({ started: false, recent: true, pid: null });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ skipped: true, reason: "bootstrap-failed" });
    await maybeAutoUpdate({ projectDir: root, config: {}, logger });
    expect(warned.filter((l) => /kj rag index --with-sources/.test(l))).toHaveLength(1);
  });

  it("stops run before the bootstrap and never block it; max-run and marked: false each warn once", async () => {
    const order = [];
    stopBootstrap.mockImplementationOnce(async () => { order.push("stop"); return null; });
    stopLeaseHolder.mockImplementationOnce(async () => { order.push("lease"); return null; });
    startBootstrap.mockImplementationOnce(() => { order.push("start"); return { started: true, pid: 1 }; });
    await maybeAutoUpdate({ projectDir: root, config: {}, logger });
    expect(order).toEqual(["stop", "lease", "start"]);

    stopBootstrap.mockRejectedValueOnce(new Error("ps gone"));
    stopLeaseHolder.mockRejectedValueOnce(new Error("ps gone"));
    startBootstrap.mockReturnValue({ started: true, pid: 2 });
    expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ reason: "bootstrapping", pid: 2 });

    startBootstrap.mockReturnValue({ started: false, recent: true, stopped: "max-run" });
    for (let i = 0; i < 2; i += 1) expect(await maybeAutoUpdate({ projectDir: root, config: {}, logger })).toMatchObject({ reason: "bootstrap-failed" });
    expect(warned.filter((l) => /ran past 60 min and was stopped: run kj rag index --with-sources/.test(l))).toHaveLength(1);

    for (let i = 0; i < 2; i += 1) {
      stopBootstrap.mockResolvedValueOnce({ pid: 9, slug: "p", marked: false });
      await maybeAutoUpdate({ projectDir: root, config: {}, logger });
    }
    expect(warned.filter((l) => /could not be noted/.test(l))).toHaveLength(1);
  });
});
