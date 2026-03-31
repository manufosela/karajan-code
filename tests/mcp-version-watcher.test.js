import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: vi.fn(),
    watch: vi.fn(() => ({ close: vi.fn() }))
  };
});

const { readFileSync, watch } = await import("node:fs");
const { setupVersionWatcher } = await import("../src/mcp/orphan-guard.js");

describe("setupVersionWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when pkgPath is not provided", () => {
    const result = setupVersionWatcher({});
    expect(result).toBeNull();
  });

  it("checkVersion calls exitFn when version changes (after grace period)", () => {
    vi.useFakeTimers();
    const exitFn = vi.fn();
    readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.0" }));

    const watcher = setupVersionWatcher({
      pkgPath: "/fake/package.json",
      currentVersion: "1.0.0",
      gracePeriodMs: 2000,
      exitFn
    });

    const changed = watcher.checkVersion();
    expect(changed).toBe(true);
    expect(exitFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(exitFn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("checkVersion does NOT call exitFn when version is the same", () => {
    const exitFn = vi.fn();
    readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));

    const { checkVersion } = setupVersionWatcher({
      pkgPath: "/fake/package.json",
      currentVersion: "1.0.0",
      exitFn
    });

    const changed = checkVersion();
    expect(changed).toBe(false);
    expect(exitFn).not.toHaveBeenCalled();
  });

  it("checkVersion ignores readFileSync errors gracefully", () => {
    const exitFn = vi.fn();
    readFileSync.mockImplementation(() => { throw new Error("ENOENT"); });

    const { checkVersion } = setupVersionWatcher({
      pkgPath: "/fake/package.json",
      currentVersion: "1.0.0",
      exitFn
    });

    const changed = checkVersion();
    expect(changed).toBe(false);
    expect(exitFn).not.toHaveBeenCalled();
  });

  it("sets up a file watcher with persistent=false", () => {
    readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));

    setupVersionWatcher({
      pkgPath: "/fake/package.json",
      currentVersion: "1.0.0",
      exitFn: vi.fn()
    });

    expect(watch).toHaveBeenCalledWith(
      "/fake/package.json",
      { persistent: false },
      expect.any(Function)
    );
  });
});
