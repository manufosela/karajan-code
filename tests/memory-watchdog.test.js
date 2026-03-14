import { afterEach, describe, expect, it, vi } from "vitest";
import { setupMemoryWatchdog } from "../src/mcp/orphan-guard.js";

describe("memory-watchdog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns a timer handle", () => {
    const { timer } = setupMemoryWatchdog({ intervalMs: 60000 });
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("calls onWarn when heap exceeds warning threshold", () => {
    vi.useFakeTimers();
    const onWarn = vi.fn();
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 600 * 1024 * 1024, // 600MB
      rss: 800 * 1024 * 1024,
      heapTotal: 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const { timer } = setupMemoryWatchdog({ intervalMs: 100, warnHeapMb: 512, criticalHeapMb: 768, onWarn });
    vi.advanceTimersByTime(100);

    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0][0]).toContain("Memory warning");

    clearInterval(timer);
  });

  it("does not warn when heap is below threshold", () => {
    vi.useFakeTimers();
    const onWarn = vi.fn();
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 100 * 1024 * 1024, // 100MB
      rss: 200 * 1024 * 1024,
      heapTotal: 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const { timer } = setupMemoryWatchdog({ intervalMs: 100, warnHeapMb: 512, onWarn });
    vi.advanceTimersByTime(300);

    expect(onWarn).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  it("calls exitFn when heap exceeds critical threshold", () => {
    vi.useFakeTimers();
    const exitFn = vi.fn();
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 800 * 1024 * 1024, // 800MB
      rss: 1024 * 1024 * 1024,
      heapTotal: 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const onCritical = vi.fn();
    const { timer } = setupMemoryWatchdog({ intervalMs: 100, criticalHeapMb: 768, exitFn, onCritical });
    vi.advanceTimersByTime(100);

    expect(exitFn).toHaveBeenCalledTimes(1);
    expect(onCritical).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("resets warn flag when heap drops below threshold", () => {
    vi.useFakeTimers();
    const onWarn = vi.fn();
    const memSpy = vi.spyOn(process, "memoryUsage");

    // First tick: above warn
    memSpy.mockReturnValue({ heapUsed: 600 * 1024 * 1024, rss: 800 * 1024 * 1024, heapTotal: 1024 * 1024 * 1024, external: 0, arrayBuffers: 0 });
    const { timer } = setupMemoryWatchdog({ intervalMs: 100, warnHeapMb: 512, criticalHeapMb: 1024, onWarn });
    vi.advanceTimersByTime(100);
    expect(onWarn).toHaveBeenCalledTimes(1);

    // Second tick: still above — should NOT warn again
    vi.advanceTimersByTime(100);
    expect(onWarn).toHaveBeenCalledTimes(1);

    // Third tick: drops below
    memSpy.mockReturnValue({ heapUsed: 100 * 1024 * 1024, rss: 200 * 1024 * 1024, heapTotal: 1024 * 1024 * 1024, external: 0, arrayBuffers: 0 });
    vi.advanceTimersByTime(100);

    // Fourth tick: above again — should warn again
    memSpy.mockReturnValue({ heapUsed: 600 * 1024 * 1024, rss: 800 * 1024 * 1024, heapTotal: 1024 * 1024 * 1024, external: 0, arrayBuffers: 0 });
    vi.advanceTimersByTime(100);
    expect(onWarn).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });

  it("attempts GC before exiting on critical", () => {
    vi.useFakeTimers();
    const exitFn = vi.fn();
    const gcFn = vi.fn();
    global.gc = gcFn;

    // GC doesn't help — still above critical after
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 800 * 1024 * 1024,
      rss: 1024 * 1024 * 1024,
      heapTotal: 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const onCritical = vi.fn();
    const { timer } = setupMemoryWatchdog({ intervalMs: 100, criticalHeapMb: 768, exitFn, onCritical });
    vi.advanceTimersByTime(100);

    expect(gcFn).toHaveBeenCalled();
    expect(exitFn).toHaveBeenCalled();

    clearInterval(timer);
    delete global.gc;
  });
});
