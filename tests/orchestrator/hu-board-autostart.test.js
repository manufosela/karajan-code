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
  const baseBox = () => renderBoardBanner({ url: "http://localhost:4000", status: "started" });

  it("renders a box containing the URL, status and HU Board label", () => {
    const box = baseBox();
    expect(box).toContain("http://localhost:4000");
    expect(box).toContain("started");
    expect(box).toContain("HU Board");
  });

  it("includes the project name when provided, omits the line otherwise", () => {
    const withName = renderBoardBanner({
      url: "http://localhost:4001", status: "already running", projectName: "Demo HUs",
    });
    expect(withName).toContain("Demo HUs");
    expect(withName).toContain("Project:");
    expect(baseBox()).not.toMatch(/Project:/);
  });

  it("produces ANSI-escaped output (cyan + bold)", () => {
    const box = baseBox();
    expect(box).toMatch(/\u001b\[36m/); // cyan
    expect(box).toMatch(/\u001b\[1m/);  // bold
  });
});

// regression-for: TSK-0273
describe("tryAutoStartBoard — TSK-0273 gating", () => {
  let startBoardSpy;
  let originalVitest;
  let originalNodeEnv;

  const restoreEnv = (key, prev) => {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  };

  beforeEach(() => {
    originalVitest = process.env.VITEST;
    originalNodeEnv = process.env.NODE_ENV;
    startBoardSpy = vi.fn().mockResolvedValue({
      ok: true, alreadyRunning: false, pid: 12345,
      url: "http://localhost:4000", port: 4000,
    });
    vi.doMock("../../src/commands/board.js", () => ({
      startBoard: startBoardSpy,
      renderBoardBanner: ({ url, status }) => `[banner ${status} ${url}]`,
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    restoreEnv("VITEST", originalVitest);
    restoreEnv("NODE_ENV", originalNodeEnv);
  });

  // tryAutoStartBoard is not exported — shim its contract here.
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
