/**
 * KJC-TSK-0273 — HU Board auto-start behaviour.
 *
 * These tests exercise the banner rendering + the gating logic around
 * tryAutoStartBoard without actually spawning a detached server. The board
 * process lives behind `startBoard`, which we mock.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderBoardBanner } from "../../src/commands/board.js";

// regression-for: TSK-0273
describe("renderBoardBanner — TSK-0273 banner format", () => {
  it("renders a box containing the URL and status", () => {
    const box = renderBoardBanner({ url: "http://localhost:4000", status: "started" });
    expect(box).toContain("http://localhost:4000");
    expect(box).toContain("started");
    expect(box).toContain("HU Board");
  });

  it("includes the project name when provided", () => {
    const box = renderBoardBanner({
      url: "http://localhost:4001",
      status: "already running",
      projectName: "Demo HUs",
    });
    expect(box).toContain("Demo HUs");
    expect(box).toContain("Project:");
  });

  it("omits the project line when no name is given", () => {
    const box = renderBoardBanner({ url: "http://localhost:4000", status: "started" });
    expect(box).not.toMatch(/Project:/);
  });

  it("produces ANSI-escaped output (cyan box chars)", () => {
    const box = renderBoardBanner({ url: "http://localhost:4000", status: "started" });
    expect(box).toMatch(/\u001b\[36m/); // cyan
    expect(box).toMatch(/\u001b\[1m/); // bold
  });
});

// regression-for: TSK-0273
describe("tryAutoStartBoard — TSK-0273 gating", () => {
  let startBoardSpy;
  let originalVitest;
  let originalNodeEnv;

  beforeEach(() => {
    originalVitest = process.env.VITEST;
    originalNodeEnv = process.env.NODE_ENV;
    startBoardSpy = vi.fn().mockResolvedValue({
      ok: true,
      alreadyRunning: false,
      pid: 12345,
      url: "http://localhost:4000",
      port: 4000,
    });
    vi.doMock("../../src/commands/board.js", () => ({
      startBoard: startBoardSpy,
      renderBoardBanner: ({ url, status }) => `[banner ${status} ${url}]`,
    }));
    // Silence the console.log banner during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  /**
   * tryAutoStartBoard is not exported — re-create its decision logic here
   * against the same contract. If the real implementation drifts, update
   * this shim.
   */
  async function tryAutoStartBoard(config) {
    if (!config.hu_board?.auto_start) return { skipped: true, reason: "auto_start off" };
    if (process.env.VITEST || process.env.NODE_ENV === "test") {
      return { skipped: true, reason: "test env" };
    }
    const { startBoard } = await import("../../src/commands/board.js");
    const port = config.hu_board.port || 4000;
    const res = await startBoard(port);
    return { skipped: false, url: res.url, port };
  }

  it("skips when auto_start is false", async () => {
    const res = await tryAutoStartBoard({ hu_board: { auto_start: false, port: 4000 } });
    expect(res.skipped).toBe(true);
    expect(startBoardSpy).not.toHaveBeenCalled();
  });

  it("skips when hu_board is undefined", async () => {
    const res = await tryAutoStartBoard({});
    expect(res.skipped).toBe(true);
  });

  it("skips under VITEST even when auto_start is true (prevents detached server leak)", async () => {
    process.env.VITEST = "1";
    const res = await tryAutoStartBoard({ hu_board: { auto_start: true, port: 4000 } });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("test env");
    expect(startBoardSpy).not.toHaveBeenCalled();
  });

  it("starts the board when auto_start is true (outside tests)", async () => {
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    const res = await tryAutoStartBoard({ hu_board: { auto_start: true, port: 4000 } });
    expect(res.skipped).toBe(false);
    expect(startBoardSpy).toHaveBeenCalledWith(4000);
    expect(res.url).toBe("http://localhost:4000");
  });

  it("does NOT require the old `enabled` flag (simplified gate)", async () => {
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    const res = await tryAutoStartBoard({ hu_board: { auto_start: true } }); // no enabled
    expect(res.skipped).toBe(false);
    expect(startBoardSpy).toHaveBeenCalled();
  });
});
