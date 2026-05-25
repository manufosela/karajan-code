// KJC-TSK-0441 — watcher PID lifecycle helpers.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePidFile, readPidFile, clearPidFile, isPidAlive } from "../../src/rag/watcher.js";

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
