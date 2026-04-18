import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args) => mockSpawn(...args),
}));

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(),
}));

/**
 * Produce a fake child process that emits a JSON-RPC response after a tick.
 */
function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.unref = vi.fn();
  setImmediate(() => {
    if (options.response) {
      child.stdout.emit("data", Buffer.from(options.response));
    } else if (options.errorOnExit !== undefined) {
      child.emit("exit", options.errorOnExit);
    } else if (options.errorOnSpawn) {
      child.emit("error", options.errorOnSpawn);
    }
  });
  return child;
}

describe("checks/mcp-health", () => {
  let mod;

  beforeEach(async () => {
    vi.resetAllMocks();
    mod = await import("../../src/checks/mcp-health.js");
  });

  it("karajan-mcp OK when it responds with JSON-RPC result", async () => {
    mockSpawn.mockImplementation(() =>
      fakeChild({ response: '{"jsonrpc":"2.0","id":1,"result":{}}\n' })
    );
    const check = mod.createKarajanMcpCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(true);
  });

  it("karajan-mcp WARN when the process exits before responding", async () => {
    mockSpawn.mockImplementation(() => fakeChild({ errorOnExit: 2 }));
    const check = mod.createKarajanMcpCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
  });

  it("karajan-mcp WARN on spawn error", async () => {
    mockSpawn.mockImplementation(() => {
      const c = fakeChild();
      setImmediate(() => c.emit("error", new Error("ENOENT")));
      return c;
    });
    const check = mod.createKarajanMcpCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
  });

  it("karajan-mcp remediate re-spawns detached", async () => {
    const detachedChild = fakeChild();
    mockSpawn.mockImplementation(() => detachedChild);
    const check = mod.createKarajanMcpCheck();
    const rem = await check.remediate({ extra: { binPath: "/x/bin" } });
    expect(rem.fixed).toBe(true);
    expect(detachedChild.unref).toHaveBeenCalled();
  });

  it("serena check applies only when serena is enabled", () => {
    const check = mod.createSerenaMcpCheck();
    expect(check.applies({})).toBe(false);
    expect(check.applies({ serena: { enabled: false } })).toBe(false);
    expect(check.applies({ serena: { enabled: true } })).toBe(true);
  });
});
