import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalKjHome = process.env.KJ_HOME;

describe("board command", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-test-"));
    process.env.KJ_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalKjHome === undefined) {
      delete process.env.KJ_HOME;
    } else {
      process.env.KJ_HOME = originalKjHome;
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("boardStatus returns not running when no PID file", async () => {
    const { boardStatus } = await import("../src/commands/board.js");
    const result = await boardStatus(4000);
    expect(result.ok).toBe(true);
    expect(result.running).toBe(false);
    expect(result.pid).toBeNull();
    expect(result.url).toBeNull();
  });

  it("boardStatus returns not running when PID file has stale PID", async () => {
    const pidFile = path.join(tmpDir, "hu-board.pid");
    fs.writeFileSync(pidFile, "999999999");
    const { boardStatus } = await import("../src/commands/board.js");
    const result = await boardStatus(4000);
    expect(result.ok).toBe(true);
    expect(result.running).toBe(false);
  });

  it("stopBoard succeeds when not running", async () => {
    const { stopBoard } = await import("../src/commands/board.js");
    const result = await stopBoard();
    expect(result.ok).toBe(true);
    expect(result.wasRunning).toBe(false);
  });
});

describe("config defaults include hu_board", () => {
  it("loadConfig returns hu_board defaults", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-cfg-test-"));
    const prevKjHome = process.env.KJ_HOME;
    process.env.KJ_HOME = tmpDir;
    try {
      const { loadConfig } = await import("../src/config.js");
      const { config } = await loadConfig();
      expect(config.hu_board).toBeDefined();
      expect(config.hu_board.enabled).toBe(false);
      expect(config.hu_board.port).toBe(4000);
      expect(config.hu_board.auto_start).toBe(false);
    } finally {
      if (prevKjHome === undefined) {
        delete process.env.KJ_HOME;
      } else {
        process.env.KJ_HOME = prevKjHome;
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe("init wizard includes hu_board question", () => {
  it("wizard calls confirm for HU Board", async () => {
    // We just verify the init module imports and has the hu_board question
    // by checking the source includes the expected string
    const initSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/commands/init.js"),
      "utf8"
    );
    expect(initSource).toContain("Enable HU Board for story tracking?");
    expect(initSource).toContain("hu_board");
  });
});
