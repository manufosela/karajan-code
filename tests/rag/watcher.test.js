// KJC-TSK-0441 — watcher PID lifecycle helpers.
// KJC-TSK-0482 — multi-lang source matcher (Python/Rust/Go/Java).
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePidFile, readPidFile, clearPidFile, isPidAlive, isWatchable } from "../../src/rag/watcher.js";

describe("rag/watcher — PID file (KJC-TSK-0441)", () => {
  let prev;
  beforeEach(() => { prev = process.env.KARAJAN_HOME; process.env.KARAJAN_HOME = mkdtempSync(join(tmpdir(), "kj-watch-")); });
  afterEach(() => { rmSync(process.env.KARAJAN_HOME, { recursive: true, force: true }); if (prev === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prev; });

  it("write/read/clear round-trip + malformed → null", () => {
    expect(readPidFile()).toBeNull();
    writePidFile(12345);
    expect(readPidFile()).toBe(12345);
    expect(existsSync(join(process.env.KARAJAN_HOME, "watcher.pid"))).toBe(true);
    clearPidFile();
    expect(readPidFile()).toBeNull();
    writePidFile("not-a-pid");
    expect(readPidFile()).toBeNull();
  });

  it("isPidAlive returns true for current pid, false for 0/null/999999", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(null)).toBe(false);
    expect(isPidAlive(999999)).toBe(false);
  });

  it("clearPidFile is a no-op when missing", () => {
    expect(() => clearPidFile()).not.toThrow();
  });
});

describe("rag/watcher — multi-lang source matcher (KJC-TSK-0482)", () => {
  it("accepts every code extension registered in the language registry (JS/Py/Rust/Go/Java)", () => {
    expect(isWatchable("/repo/src/main.js")).toBe(true);
    expect(isWatchable("/repo/src/main.ts")).toBe(true);
    expect(isWatchable("/repo/src/app.py")).toBe(true);
    expect(isWatchable("/repo/src/lib.rs")).toBe(true);
    expect(isWatchable("/repo/cmd/main.go")).toBe(true);
    expect(isWatchable("/repo/src/Alpha.java")).toBe(true);
  });

  it("rejects non-code extensions and SKIP_SEGMENTS regardless of extension", () => {
    expect(isWatchable("/repo/README.md")).toBe(false);
    expect(isWatchable("/repo/data.json")).toBe(false);
    expect(isWatchable("/repo/node_modules/foo/index.js")).toBe(false);
    expect(isWatchable("/repo/.git/HEAD")).toBe(false);
    expect(isWatchable("/repo/dist/bundle.js")).toBe(false);
    expect(isWatchable("/repo/coverage/lcov.info")).toBe(false);
    expect(isWatchable("/repo/.karajan/scratch/foo.py")).toBe(false);
  });

  it("keeps the karajan onboarding/plans special-cases (md / json only inside their dirs)", () => {
    expect(isWatchable("/repo/.karajan/onboarding/brief.md")).toBe(true);
    expect(isWatchable("/repo/.karajan/onboarding/brief.txt")).toBe(false);
    expect(isWatchable("/repo/.karajan/plans/p1.json")).toBe(true);
    expect(isWatchable("/repo/.karajan/plans/p1.md")).toBe(false);
  });
});
