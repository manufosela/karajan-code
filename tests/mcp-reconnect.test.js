import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";

// Use a temp directory for marker files to avoid polluting ~/.kj
const TEST_MARKER_DIR = path.join(os.tmpdir(), "kj-reconnect-test-" + process.pid);
const TEST_MARKER_PATH = path.join(TEST_MARKER_DIR, ".mcp-restart");

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    unlinkSync: vi.fn(actual.unlinkSync),
    existsSync: vi.fn(actual.existsSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    watch: vi.fn(() => ({ close: vi.fn() }))
  };
});

const fs = await import("node:fs");
const { setupVersionWatcher, writeRestartMarker, readAndDeleteRestartMarker } = await import(
  "../src/mcp/orphan-guard.js"
);

describe("MCP reconnect after npm update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("setupVersionWatcher grace period", () => {
    it("delays exit by grace period when version changes", () => {
      const exitFn = vi.fn();
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.0" }));

      const watcher = setupVersionWatcher({
        pkgPath: "/fake/package.json",
        currentVersion: "1.0.0",
        gracePeriodMs: 2000,
        exitFn,
        markerPath: TEST_MARKER_PATH
      });

      const changed = watcher.checkVersion();
      expect(changed).toBe(true);
      // exitFn should NOT be called immediately
      expect(exitFn).not.toHaveBeenCalled();

      // After grace period, exitFn should be called
      vi.advanceTimersByTime(2000);
      expect(exitFn).toHaveBeenCalledOnce();
    });

    it("does not exit when version is unchanged", () => {
      const exitFn = vi.fn();
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));

      const watcher = setupVersionWatcher({
        pkgPath: "/fake/package.json",
        currentVersion: "1.0.0",
        gracePeriodMs: 2000,
        exitFn,
        markerPath: TEST_MARKER_PATH
      });

      const changed = watcher.checkVersion();
      expect(changed).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(exitFn).not.toHaveBeenCalled();
    });

    it("logs restart message to stderr when version changes", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exitFn = vi.fn();
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.0" }));

      const watcher = setupVersionWatcher({
        pkgPath: "/fake/package.json",
        currentVersion: "1.0.0",
        gracePeriodMs: 2000,
        exitFn,
        markerPath: TEST_MARKER_PATH
      });

      watcher.checkVersion();

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Karajan MCP updated (v1.0.0 → v2.0.0). Restarting...")
      );
      stderrSpy.mockRestore();
    });
  });

  describe("writeRestartMarker", () => {
    it("writes marker file with new version", () => {
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      writeRestartMarker("2.0.0", TEST_MARKER_PATH);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.dirname(TEST_MARKER_PATH),
        { recursive: true }
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        TEST_MARKER_PATH,
        "2.0.0",
        "utf8"
      );
    });

    it("is called when version changes", () => {
      const exitFn = vi.fn();
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.0" }));
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});

      const watcher = setupVersionWatcher({
        pkgPath: "/fake/package.json",
        currentVersion: "1.0.0",
        gracePeriodMs: 2000,
        exitFn,
        markerPath: TEST_MARKER_PATH
      });

      watcher.checkVersion();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        TEST_MARKER_PATH,
        "2.0.0",
        "utf8"
      );
    });
  });

  describe("readAndDeleteRestartMarker", () => {
    it("returns version and deletes marker when present", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue("2.0.0");
      fs.unlinkSync.mockImplementation(() => {});

      const version = readAndDeleteRestartMarker(TEST_MARKER_PATH);

      expect(version).toBe("2.0.0");
      expect(fs.unlinkSync).toHaveBeenCalledWith(TEST_MARKER_PATH);
    });

    it("returns null when marker does not exist", () => {
      fs.existsSync.mockReturnValue(false);

      const version = readAndDeleteRestartMarker(TEST_MARKER_PATH);

      expect(version).toBeNull();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("returns null on read errors", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => { throw new Error("EACCES"); });

      const version = readAndDeleteRestartMarker(TEST_MARKER_PATH);

      expect(version).toBeNull();
    });

    it("returns null for empty marker file", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue("  ");
      fs.unlinkSync.mockImplementation(() => {});

      const version = readAndDeleteRestartMarker(TEST_MARKER_PATH);

      expect(version).toBeNull();
    });
  });

  describe("normal startup without marker", () => {
    it("readAndDeleteRestartMarker returns null when no marker exists", () => {
      fs.existsSync.mockReturnValue(false);

      const version = readAndDeleteRestartMarker(TEST_MARKER_PATH);

      expect(version).toBeNull();
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
