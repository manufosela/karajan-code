import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

describe("orphan-guard", () => {
  let originalPpid;
  let originalStdin;
  let fakeStdin;
  let exitFn;

  beforeEach(() => {
    originalPpid = process.ppid;
    originalStdin = process.stdin;
    fakeStdin = new EventEmitter();
    Object.defineProperty(process, "stdin", { value: fakeStdin, writable: true, configurable: true });
    exitFn = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true, configurable: true });
    vi.restoreAllMocks();
  });

  it("calls exitFn when parent pid is dead", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("ESRCH"); });

    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const { timer } = setupOrphanGuard({ intervalMs: 100, exitFn });

    vi.advanceTimersByTime(100);
    expect(exitFn).toHaveBeenCalledTimes(1);

    clearInterval(timer);
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not call exitFn when parent pid is alive", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const { timer } = setupOrphanGuard({ intervalMs: 100, exitFn });

    vi.advanceTimersByTime(300);
    expect(exitFn).not.toHaveBeenCalled();

    clearInterval(timer);
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  it("calls exitFn when stdin emits 'end'", async () => {
    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const { timer } = setupOrphanGuard({ intervalMs: 60000, exitFn });

    fakeStdin.emit("end");
    expect(exitFn).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("calls exitFn when stdin emits 'close'", async () => {
    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const { timer } = setupOrphanGuard({ intervalMs: 60000, exitFn });

    fakeStdin.emit("close");
    expect(exitFn).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("calls exitFn on SIGHUP", async () => {
    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const { timer } = setupOrphanGuard({ intervalMs: 60000, exitFn });

    process.emit("SIGHUP");
    expect(exitFn).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("returns parentPid and timer handle", async () => {
    const { setupOrphanGuard } = await import("../src/mcp/orphan-guard.js");
    const result = setupOrphanGuard({ intervalMs: 60000, exitFn });

    expect(result.parentPid).toBe(process.ppid);
    expect(result.timer).toBeDefined();

    clearInterval(result.timer);
  });
});
