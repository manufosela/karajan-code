// HU-2757: the pid lease behind the one-background-index-per-machine rule.
import { mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { GRACE_MS, MAX_RUN_MS, claimLease, parsePs, readLease, releaseLease, stopIndexer, stopLeaseHolder, writeLease } from "../../src/rag/pid-lease.js";

let root, file;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-pid-lease-")); file = join(root, "locks", "rag-index.json"); mkdirSync(join(root, "locks")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readLease", () => {
  it("a lease caught half-written counts as running during GRACE_MS only", () => {
    writeFileSync(file, "{\"pid\": 12", "utf8");
    expect(readLease(file)).toMatchObject({ running: true });
    expect(readLease(file, { now: Date.now() + GRACE_MS + 1000 })).toMatchObject({ running: false });
  });
  it("a lease with stoppedAt never reads as running, even when the pid is alive (HU-2758)", () => {
    writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now(), stoppedAt: Date.now() }), "utf8");
    expect(readLease(file)).toMatchObject({ running: false });
  });
});
// HU-2758: an indexer past MAX_RUN_MS is stopped, but only after ps confirms what the pid runs.
describe("parsePs", () => {
  it("reads etime and command, or null", () => {
    expect(parsePs("1-02:03:04 node /k/bin/kj.js rag index\n")).toEqual({ elapsedMs: (26 * 3600 + 3 * 60 + 4) * 1000, command: "node /k/bin/kj.js rag index" });
    expect(parsePs("   05:06 vim x")).toEqual({ elapsedMs: 306000, command: "vim x" });
    expect(parsePs("")).toBeNull();
  });
});
describe("stopIndexer", () => {
  const AT = 1_000_000;
  const NOW = AT + 2 * 3600 * 1000;
  const command = "/usr/bin/node /k/bin/kj.js rag index --with-sources";
  const indexer = { elapsedMs: NOW - AT, command };
  const signals = (calls) => calls.filter(([, sig]) => sig !== 0);
  const stop = async (ps, { ignoresTerm = false, killAfterMs, recorded = command } = {}) => {
    const calls = [];
    let dead = false;
    const kill = (pid, sig) => {
      calls.push([pid, sig]);
      if (sig === "SIGKILL" || (sig === "SIGTERM" && !ignoresTerm)) dead = true;
      if (sig === 0 && dead) throw new Error("ESRCH");
    };
    await stopIndexer(4242, AT, { command: recorded, now: NOW, ps: () => ps, kill, sleep: async () => {}, killAfterMs });
    return calls;
  };
  it("leaves another command, a reused pid and a missing ps alone", async () => {
    const lookalikes = ["vim x", "vim kj rag index", "sh -c 'node /k/bin/kj.js rag index'", "/usr/bin/vim /x/node /k/kj.js rag index", "/usr/bin/node /other.js relative/kj.js rag index"];
    for (const ps of [...lookalikes.map((c) => ({ elapsedMs: NOW - AT, command: c })), { elapsedMs: 5000, command }, null]) {
      expect(await stop(ps)).toEqual([]);
    }
    expect(await stop(indexer, { recorded: null })).toEqual([]); // an older lease format: no command recorded
  });
  it("sends SIGKILL after the polls when SIGTERM is ignored", async () => {
    const calls = await stop(indexer, { ignoresTerm: true, killAfterMs: 300 });
    expect(calls.filter(([, sig]) => sig === 0)).toHaveLength(4); // three polls, then the confirmation
    expect(signals(calls)).toEqual([[-4242, "SIGTERM"], [-4242, "SIGKILL"]]);
  });
  it("recognises an indexer whose node and kj.js live in paths with spaces, and only that exact command", async () => {
    const spaced = "/Users/me/My Tools/node/bin/node /Users/me/My Projects/karajan/bin/kj.js rag index --with-sources";
    expect((await stop({ elapsedMs: NOW - AT, command: spaced }, { recorded: spaced }))[0]).toEqual([-4242, "SIGTERM"]);
    expect(await stop({ elapsedMs: NOW - AT, command: "/Users/me/My Tools/node/bin/node /other.js My Projects/karajan/bin/kj.js rag index --with-sources" }, { recorded: spaced })).toEqual([]);
  });
  it("is not stopped while the process survives SIGKILL, nor when ps stops answering and the pid lives", async () => {
    const run = (ps) => stopIndexer(4242, AT, { command, now: NOW, ps, kill: () => {}, sleep: async () => {}, killAfterMs: 200 });
    expect(await run(() => indexer)).toBe(false);
    const answers = [indexer];
    expect(await run(() => answers.shift() ?? null)).toBe(false);
  });
});
describe("stopLeaseHolder when the mutex is busy", () => {
  const stopWith = async (releaseAt) => {
    writeFileSync(file, JSON.stringify({ pid: 4242, at: 1_000_000, command: "/usr/bin/node /k/bin/kj.js rag index" }), "utf8");
    mkdirSync(`${file}.lock`);
    let waits = 0;
    let dead = false;
    const kill = (pid, sig) => { dead ||= sig === "SIGTERM"; if (sig === 0 && dead) throw new Error("ESRCH"); };
    const wait = () => { waits += 1; if (waits === releaseAt) rmdirSync(`${file}.lock`); };
    const ps = () => ({ elapsedMs: 10 * MAX_RUN_MS, command: "/usr/bin/node /k/bin/kj.js rag index" });
    return { result: await stopLeaseHolder(file, { now: 1_000_000 + MAX_RUN_MS, kill, ps, wait, sleep: async () => {} }), waits };
  };
  it("the mutex freed on the second attempt: the stop is noted", async () => {
    expect(await stopWith(1)).toMatchObject({ result: { pid: 4242, marked: true }, waits: 1 });
    expect(readLease(file)).toMatchObject({ stoppedBy: "max-run" });
  });
  it("five attempts, 20 ms apart, and still busy: marked is false and the file is untouched", async () => {
    expect(await stopWith(null)).toMatchObject({ result: { pid: 4242, marked: false }, waits: 4 });
    expect(readLease(file)).not.toHaveProperty("stoppedAt");
  });
});
// HU-2907: a foreground index claims the lease for its own pid and releases only its own claim.
describe("claimLease / releaseLease", () => {
  it("a free lease is claimed with this pid and releaseLease removes it", () => {
    expect(claimLease(file, { slug: "p" })).toEqual({ claimed: true });
    expect(readLease(file)).toMatchObject({ pid: process.pid, slug: "p", running: true });
    expect(releaseLease(file)).toEqual({ released: true });
    expect(readLease(file)).toBeNull();
  });
  it("a lease held by a live pid is left byte for byte; releaseLease does not remove it either", () => {
    writeLease(file, { pid: process.ppid, at: Date.now(), slug: "other" });
    const before = readFileSync(file, "utf8");
    expect(claimLease(file, { slug: "p" })).toMatchObject({ claimed: false, holder: { pid: process.ppid, slug: "other" } });
    expect(releaseLease(file)).toEqual({ released: false });
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("a holder that is kin (the spawning parent) or dead does not stop the claim", () => {
    writeLease(file, { pid: process.ppid, at: Date.now() });
    expect(claimLease(file, { slug: "p" }, { kin: [process.ppid] })).toEqual({ claimed: true });
    writeLease(file, { pid: 2 ** 22 - 1, at: Date.now() });
    expect(claimLease(file, { slug: "p" })).toEqual({ claimed: true });
  });
  it("a release that finds the mutex busy still counts its claim down, so the next run releases its own", () => {
    claimLease(file, { slug: "p" });
    mkdirSync(`${file}.lock`);
    expect(releaseLease(file)).toEqual({ busy: true });
    rmdirSync(`${file}.lock`);
    claimLease(file, { slug: "p" });
    expect(releaseLease(file)).toEqual({ released: true });
  });
  it("a mutex that frees up by the second attempt still lets the release remove the lease", () => {
    claimLease(file, { slug: "p" });
    mkdirSync(`${file}.lock`);
    expect(releaseLease(file, { sleep: () => rmdirSync(`${file}.lock`) })).toEqual({ released: true });
    expect(readLease(file)).toBeNull();
  });
  it("two overlapping claims of one process: the first release keeps the lease, the last removes it", () => {
    claimLease(file, { slug: "p" });
    claimLease(file, { slug: "p" });
    expect(releaseLease(file)).toEqual({ released: false, shared: true });
    expect(readLease(file)).toMatchObject({ pid: process.pid, running: true });
    expect(releaseLease(file)).toEqual({ released: true });
    expect(readLease(file)).toBeNull();
  });
});
