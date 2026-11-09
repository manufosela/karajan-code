import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalKjHome = process.env.KJ_HOME;

/** A port nothing listens on: the OS hands one out and it is closed at once. */
const freePort = () => new Promise((resolve) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

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
    const { boardStatus } = await import("../../src/commands/board.js");
    const result = await boardStatus(4000);
    expect(result.ok).toBe(true);
    expect(result.running).toBe(false);
    expect(result.pid).toBeNull();
    expect(result.url).toBeNull();
  });

  it("boardStatus returns not running when PID file has stale PID", async () => {
    const pidFile = path.join(tmpDir, "hu-board.pid");
    fs.writeFileSync(pidFile, "999999999");
    const { boardStatus } = await import("../../src/commands/board.js");
    const result = await boardStatus(4000);
    expect(result.ok).toBe(true);
    expect(result.running).toBe(false);
  });

  it("stopBoard succeeds when not running", async () => {
    // KJC-BUG-0536: the real stopBoard() asked lsof who listens on 4000 on any interface
    // and SIGTERMed the user's own board, bound to another address. The test never
    // reaches the host: a free port, no port occupant, and process.kill a stub.
    vi.resetModules();
    vi.doMock("../../src/utils/port-occupant.js", () => ({ getPortOccupant: async () => null }));
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const { stopBoard } = await import("../../src/commands/board.js");
      const result = await stopBoard({ port: await freePort() });
      expect(result.ok).toBe(true);
      expect(result.wasRunning).toBe(false);
      expect(kill.mock.calls.filter(([, signal]) => signal === "SIGTERM")).toEqual([]);
    } finally {
      kill.mockRestore();
      vi.doUnmock("../../src/utils/port-occupant.js");
    }
  });
});

describe("config defaults include hu_board", () => {
  it("loadConfig returns hu_board defaults", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-cfg-test-"));
    const prevKjHome = process.env.KJ_HOME;
    process.env.KJ_HOME = tmpDir;
    // loadConfig refuses local config without a global counterpart
    // (KJC-TSK-0395). Pre-seed an empty global config.
    fs.writeFileSync(path.join(tmpDir, "kj.config.yml"), "");
    try {
      const { loadConfig } = await import("../../src/config.js");
      // The tmp dir as project: this repo's own kj.config.yml declares false.
      const { config } = await loadConfig(tmpDir);
      expect(config.hu_board).toBeDefined();
      // KJC-TSK-0884: on by default, like Sonar.
      expect(config.hu_board.enabled).toBe(true);
      expect(config.hu_board.port).toBe(4000);
      expect(config.hu_board.auto_start).toBe(true);
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
      path.resolve(import.meta.dirname, "../../src/commands/init.js"),
      "utf8"
    );
    expect(initSource).toContain("Enable the HU Board");
    expect(initSource).toContain("hu_board");
  });
});
