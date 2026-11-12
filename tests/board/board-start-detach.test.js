import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression for v2.7.5: `kj board start` was leaving the terminal
// hanging because we spawned the child detached but never called
// `child.unref()`. The parent's event loop kept a reference to the
// child handle and never exited, so the prompt didn't return.
//
// We can't actually launch the board server in a unit test, so we
// stub `child_process.spawn` and assert the spawn options + that
// `unref()` was called on the returned child object.

const unref = vi.fn();
// `once`/`removeListener` are needed by waitForEarlyExit; the mock
// child never emits "exit", so the early-exit watcher just times out
// (KJ_BOARD_START_WINDOW_MS keeps that near-instant in tests).
const child = { pid: 4242, on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), unref };
const spawn = vi.fn(() => child);

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:net", () => ({
  default: {
    createServer: () => ({
      once: (event, cb) => {
        if (event === "listening") setImmediate(cb);
      },
      listen: (_port, host) => { listenedHosts.push(host); },
      close: (cb) => cb && cb(),
    }),
  },
}));
// startBoard HTTP-probes the configured port twice: once as a
// pre-spawn fallback (stale PID file) and once as a post-spawn
// readiness check (KJC-BUG-0080). Mock state lets us simulate
// "no board there" before spawn and "board answered" after spawn.
let httpCallIdx = 0;
let httpAlwaysFail = false;
let httpFailUntil = 0;
let probedHosts = [];
const listenedHosts = [];
vi.mock("node:http", () => {
  return {
    default: {
      request: (opts, cb) => {
        probedHosts.push(opts.host);
        const idx = httpCallIdx++;
        const handlers = {};
        return {
          on: (ev, h) => { handlers[ev] = h; },
          end: () => {
            setImmediate(() => {
              if (httpAlwaysFail || idx === 0 || idx < httpFailUntil) {
                handlers.error?.(new Error("ECONNREFUSED"));
              } else {
                cb?.({ statusCode: 200, resume() {} });
              }
            });
          },
          destroy: () => {},
        };
      },
    },
  };
});

let tmpHome;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-board-start-"));
  process.env.KJ_HOME = tmpHome;
  process.env.KJ_BOARD_START_WINDOW_MS = "20";
  process.env.KJ_BOARD_READY_TIMEOUT_MS = "200";
  httpCallIdx = 0;
  httpAlwaysFail = false;
  httpFailUntil = 0;
  probedHosts = [];
  listenedHosts.length = 0;
  unref.mockReset();
  child.once.mockReset();
  child.removeListener.mockReset();
  spawn.mockClear();
  child.on.mockClear();
  // The module captures KJ_HOME at load time (`const PID_FILE = ...`),
  // so we must re-import it after each env tweak to pick up the new
  // tmp dir.
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_BOARD_START_WINDOW_MS;
  delete process.env.KJ_BOARD_READY_TIMEOUT_MS;
});

describe("startBoard — detaches properly", () => {
  it("calls child.unref() so the parent process can exit", async () => {
    const { startBoard } = await import("../../src/commands/board.js");
    await startBoard(4000);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("spawns with detached:true and stdio routed to a log file (no parent pipe references)", async () => {
    // Pre-2026-05-07 the daemon was spawned with stdio: "ignore", which
    // sent every console.log from server.js to /dev/null and made
    // debugging — particularly the [zombie-reaper] line — invisible.
    // Now stdout/stderr are redirected to ~/.karajan/hu-board.log so
    // `tail -f` works. The pin: index 0 is "ignore" (the daemon never
    // reads stdin), indices 1 and 2 are file descriptors (numbers).
    const { startBoard } = await import("../../src/commands/board.js");
    await startBoard(4000);
    const opts = spawn.mock.calls[0][2];
    expect(opts.detached).toBe(true);
    expect(Array.isArray(opts.stdio)).toBe(true);
    expect(opts.stdio[0]).toBe("ignore");
    expect(typeof opts.stdio[1]).toBe("number");  // log file fd
    expect(typeof opts.stdio[2]).toBe("number");  // same fd, stderr → log
    expect(opts.stdio[1]).toBe(opts.stdio[2]);    // stdout + stderr merged
  });

  it("writes the PID file so subsequent kj board status / stop find the child", async () => {
    const { startBoard } = await import("../../src/commands/board.js");
    const result = await startBoard(4000);
    expect(result.pid).toBe(4242);
    const pidPath = join(tmpHome, "hu-board.pid");
    expect(existsSync(pidPath)).toBe(true);
    expect(readFileSync(pidPath, "utf-8")).toBe("4242");
  });

  // KJC-BUG-0080 regression: the daemon survives the early-exit
  // window but never answers HTTP — pre-fix the CLI happily printed
  // "HU Board started at http://localhost:4000" while the port was
  // dead. Now startBoard throws and the PID file stays unwritten so
  // the next kj run knows the previous attempt failed.
  it("throws when the daemon never answers /api/dashboard within the readiness budget", async () => {
    httpAlwaysFail = true;
    process.env.KJ_BOARD_READY_TIMEOUT_MS = "50";
    const { startBoard } = await import("../../src/commands/board.js");
    await expect(startBoard(4000)).rejects.toThrow(
      /did not answer on http:\/\/localhost:4000/
    );
    const pidPath = join(tmpHome, "hu-board.pid");
    expect(existsSync(pidPath)).toBe(false);
  });

  // HU-4115: a board that reads every plan on boot answers late. While the
  // process lives, startBoard keeps waiting up to KJ_BOARD_BOOT_TIMEOUT_MS.
  describe("a board still booting after the first budget", () => {
    let killSpy;
    beforeEach(() => {
      killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
      process.env.KJ_BOARD_READY_TIMEOUT_MS = "30";
      process.env.KJ_BOARD_BOOT_TIMEOUT_MS = "1500";
    });
    afterEach(() => {
      killSpy.mockRestore();
      delete process.env.KJ_BOARD_BOOT_TIMEOUT_MS;
    });

    it("succeeds when it answers within the ceiling and says so once", async () => {
      httpFailUntil = 8;
      const logger = { info: vi.fn() };
      const { startBoard } = await import("../../src/commands/board.js");
      const result = await startBoard(4000, { logger });
      expect(result.ok).toBe(true);
      const lines = logger.info.mock.calls.map((c) => c[0]).filter((l) => l.includes("still starting"));
      expect(lines).toHaveLength(1);
      expect(existsSync(join(tmpHome, "hu-board.pid"))).toBe(true);
    });

    it("reports the early-exit error when the process dies while waiting", async () => {
      httpAlwaysFail = true;
      const { startBoard } = await import("../../src/commands/board.js");
      const pending = startBoard(4000, { logger: { info: vi.fn() } });
      const rejection = expect(pending).rejects.toThrow(/died on startup \(exit code 1\)/);
      await new Promise((r) => setTimeout(r, 150));
      const exitCalls = child.once.mock.calls.filter((c) => c[0] === "exit");
      exitCalls.at(-1)[1](1, null);
      await rejection;
    });

    it("names the time waited when it never answers past the ceiling", async () => {
      httpAlwaysFail = true;
      process.env.KJ_BOARD_BOOT_TIMEOUT_MS = "300";
      const { startBoard } = await import("../../src/commands/board.js");
      await expect(startBoard(4000, { logger: { info: vi.fn() } })).rejects.toThrow(
        /did not answer on http:\/\/localhost:4000 in time \(waited \d+ s more\)/
      );
      expect(existsSync(join(tmpHome, "hu-board.pid"))).toBe(false);
    });
  });

  // KJC-BUG-0498: bound to one address the server listens only there, so the
  // probes and the free-port check go there too, and the PID is written.
  it("with --bind to an address, checks the port and the board's health on that address", async () => {
    const { startBoard } = await import("../../src/commands/board.js");
    const result = await startBoard(4000, { bind: "100.64.0.7" });
    expect(result.pid).toBe(4242);
    expect(new Set(probedHosts)).toEqual(new Set(["100.64.0.7"]));
    expect(new Set(listenedHosts)).toEqual(new Set(["100.64.0.7"]));
    expect(readFileSync(join(tmpHome, "hu-board.pid"), "utf-8")).toBe("4242");
  });

  it("bound to every interface (0.0.0.0 or ::), it checks on loopback, where the server also answers", async () => {
    const { startBoard } = await import("../../src/commands/board.js");
    await startBoard(4000, { bind: "0.0.0.0" });
    await startBoard(4000, { bind: "::" }).catch(() => {});
    expect(new Set(probedHosts)).toEqual(new Set(["127.0.0.1"]));
  });
});
