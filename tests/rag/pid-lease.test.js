// HU-2757: the pid lease behind the one-background-index-per-machine rule.
import { mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { GRACE_MS, claimLease, readLease, releaseLease, writeLease } from "../../src/rag/pid-lease.js";

let root, file;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-pid-lease-")); file = join(root, "locks", "rag-index.json"); mkdirSync(join(root, "locks")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readLease", () => {
  it("a lease caught half-written counts as running during GRACE_MS only", () => {
    writeFileSync(file, "{\"pid\": 12", "utf8");
    expect(readLease(file)).toMatchObject({ running: true });
    expect(readLease(file, { now: Date.now() + GRACE_MS + 1000 })).toMatchObject({ running: false });
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
