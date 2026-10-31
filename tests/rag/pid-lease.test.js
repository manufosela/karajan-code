// HU-2757: the pid lease behind the one-background-index-per-machine rule.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GRACE_MS, readLease } from "../../src/rag/pid-lease.js";

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
