import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression for the user's report: `kj board stop` returned
// "wasn't running" while a board was clearly serving requests on
// localhost:4000. Cause: the running server was built before the
// server-writes-own-PID fix (PR #508), so the PID file was either
// missing or pointing at a long-dead process. The CLI's PID-only
// stop path declared victory and walked away from the ghost.
//
// New stopBoard tries three strategies in order:
//   1. PID file (existing behaviour)
//   2. POST /api/board/shutdown (works against any modern server)
//   3. getPortOccupant + SIGTERM (for old servers without the API)

const httpRequest = vi.fn();
vi.mock("node:http", () => ({
  default: { request: (...args) => httpRequest(...args) },
}));

const portOccupant = vi.fn();
vi.mock("../../src/utils/port-occupant.js", () => ({
  getPortOccupant: (...args) => portOccupant(...args),
}));

let tmpHome;
const originalKill = process.kill;
let killCalls;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "kj-board-stop-"));
  process.env.KJ_HOME = tmpHome;
  httpRequest.mockReset();
  portOccupant.mockReset();
  vi.resetModules();
  killCalls = [];
  // Stub process.kill globally so SIGTERM paths don't actually fire
  // in the test runner (signal 0 is still allowed for liveness probe).
  process.kill = (pid, sig) => {
    killCalls.push({ pid, sig });
    if (sig === 0) {
      // Probe-mode: throw ESRCH to signal "no such process" unless
      // the test sets ALIVE_PIDS.
      if (!global.__alivePids?.has(pid)) {
        const e = new Error("kill ESRCH");
        e.code = "ESRCH";
        throw e;
      }
      return true;
    }
    return true;
  };
});

afterEach(() => {
  process.kill = originalKill;
  delete global.__alivePids;
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

const BOARD_VERSION = JSON.stringify({ version: "1.0.0", boot_time: "2026-01-01T00:00:00.000Z" });

function fakeReq() {
  return { on: () => {}, end: () => {}, write: () => {}, destroy: () => {} };
}

function replyWith(cb, status, body) {
  const handlers = {};
  const res = { statusCode: status, resume: () => {}, on: (ev, fn) => { handlers[ev] = fn; } };
  setImmediate(() => { cb(res); handlers.data?.(body); handlers.end?.(); });
}

// GET /api/version answers `versionBody`; every other request answers `status`.
function mockHttpReply(status, versionBody = BOARD_VERSION) {
  httpRequest.mockImplementation((opts, cb) => {
    if (opts.path === "/api/version") replyWith(cb, 200, versionBody);
    else replyWith(cb, status, "{}");
    return fakeReq();
  });
}

// An old board: identifies itself on /api/version but has no shutdown endpoint.
function mockOldBoardNoShutdown() {
  httpRequest.mockImplementation((opts, cb) => {
    if (opts.path === "/api/version") {
      replyWith(cb, 200, BOARD_VERSION);
      return fakeReq();
    }
    const handlers = {};
    setImmediate(() => handlers.error?.(new Error("ECONNREFUSED")));
    return { ...fakeReq(), on: (ev, fn) => { handlers[ev] = fn; } };
  });
}

function mockHttpError() {
  httpRequest.mockImplementation(() => {
    const handlers = {};
    setImmediate(() => handlers.error?.(new Error("ECONNREFUSED")));
    return {
      on: (ev, cb) => { handlers[ev] = cb; },
      end: () => {},
      write: () => {},
      destroy: () => {},
    };
  });
}

describe("stopBoard — three-step fallback", () => {
  it("strategy 1: live PID in the file → SIGTERM via PID, reports via:pidfile", async () => {
    writeFileSync(join(tmpHome, "hu-board.pid"), "12345");
    global.__alivePids = new Set([12345]);
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result).toMatchObject({ wasRunning: true, pid: 12345, via: "pidfile" });
    expect(killCalls.some((c) => c.pid === 12345 && c.sig === "SIGTERM")).toBe(true);
  });

  it("strategy 2: stale PID file → API shutdown succeeds, reports via:api", async () => {
    writeFileSync(join(tmpHome, "hu-board.pid"), "99999");
    // 99999 is NOT in __alivePids → isProcessAlive returns false → fall through
    mockHttpReply(200);
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result).toMatchObject({ wasRunning: true, via: "api" });
  });

  it("strategy 2: PID file missing entirely → API shutdown still works", async () => {
    mockHttpReply(200);
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result.via).toBe("api");
  });

  it("strategy 3: API endpoint unavailable (old build) → port-occupant SIGTERM, reports via:port-occupant", async () => {
    mockOldBoardNoShutdown();
    portOccupant.mockResolvedValue({ port: 4000, pid: 7777, command: "node", raw: "" });
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result).toMatchObject({ wasRunning: true, pid: 7777, via: "port-occupant" });
    expect(killCalls.some((c) => c.pid === 7777 && c.sig === "SIGTERM")).toBe(true);
  });

  it("nothing running anywhere → wasRunning:false, no kill calls", async () => {
    mockHttpError();
    portOccupant.mockResolvedValue(null);
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result).toEqual({ ok: true, wasRunning: false });
    expect(killCalls.filter((c) => c.sig === "SIGTERM")).toHaveLength(0);
  });

  it("API succeeds preempts the port-occupant fallback (no double-kill)", async () => {
    mockHttpReply(200);
    portOccupant.mockResolvedValue({ port: 4000, pid: 8888, command: "node", raw: "" });
    const { stopBoard } = await import("../../src/commands/board.js");
    await stopBoard({ port: 4000 });
    expect(killCalls.filter((c) => c.sig === "SIGTERM")).toHaveLength(0);
    expect(portOccupant).not.toHaveBeenCalled();
  });

  it("HU-4111: a foreign HTTP server on the port is neither shut down nor killed", async () => {
    mockHttpReply(200, "<html>not a board</html>");
    portOccupant.mockResolvedValue({ port: 4000, pid: 5555, command: "node", raw: "" });
    const { stopBoard } = await import("../../src/commands/board.js");
    const result = await stopBoard({ port: 4000 });
    expect(result).toEqual({ ok: true, wasRunning: false });
    expect(killCalls.filter((c) => c.sig === "SIGTERM")).toHaveLength(0);
    expect(portOccupant).not.toHaveBeenCalled();
    expect(httpRequest.mock.calls.some(([o]) => o.method === "POST")).toBe(false);
  });
});
