// KJC-TSK-0441 — `kj watch` CLI handlers.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/rag/watcher.js", () => ({
  startWatcher: vi.fn(() => async () => {}),
  readPidFile: vi.fn(), clearPidFile: vi.fn(), isPidAlive: vi.fn(), writePidFile: vi.fn(),
}));
import { readPidFile, clearPidFile, isPidAlive } from "../../src/rag/watcher.js";
import { watchStopCommand, watchStatusCommand } from "../../src/commands/watch.js";

const logger = { info: vi.fn(), warn: vi.fn() };

describe("kj watch — KJC-TSK-0441", () => {
  beforeEach(() => { for (const m of [logger.info, logger.warn, readPidFile, clearPidFile, isPidAlive]) m.mockReset(); });

  it("status: running / stale / NOT running paths", async () => {
    readPidFile.mockReturnValueOnce(process.pid); isPidAlive.mockReturnValueOnce(true);
    expect((await watchStatusCommand({ logger })).alive).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/running/));
    readPidFile.mockReturnValueOnce(999999); isPidAlive.mockReturnValueOnce(false);
    await watchStatusCommand({ logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/Stale PID/));
    readPidFile.mockReturnValueOnce(null);
    expect((await watchStatusCommand({ logger })).alive).toBeFalsy();
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/NOT running/));
  });

  it("stop: no PID / stale PID paths", async () => {
    readPidFile.mockReturnValueOnce(null);
    expect((await watchStopCommand({ logger })).stopped).toBe(false);
    expect(logger.info).toHaveBeenCalledWith("No watcher running.");
    readPidFile.mockReturnValueOnce(999999); isPidAlive.mockReturnValueOnce(false);
    const r = await watchStopCommand({ logger });
    expect(r.stale).toBe(true);
    expect(clearPidFile).toHaveBeenCalled();
  });
});
