import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { createActivityLog } from "../src/activity-log.js";

vi.mock("node:fs/promises", () => ({
  default: {
    appendFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../src/utils/paths.js", () => ({
  getSessionRoot: () => "/tmp/test-sessions"
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined)
}));

describe("createActivityLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a log with correct path", () => {
    const log = createActivityLog("s_2026-02-17T10-00-00-000Z");
    expect(log.path).toBe("/tmp/test-sessions/s_2026-02-17T10-00-00-000Z/activity.log");
  });

  it("write formats log entries with timestamp and level", async () => {
    const log = createActivityLog("s_test");
    log.write({
      level: "info",
      timestamp: "2026-02-17T10:00:00.000Z",
      context: { iteration: 1, stage: "coder" },
      message: "Coder started"
    });

    // Wait for async flush
    await new Promise((r) => setTimeout(r, 50));

    expect(fs.appendFile).toHaveBeenCalledTimes(1);
    const written = fs.appendFile.mock.calls[0][1];
    expect(written).toContain("2026-02-17T10:00:00.000Z");
    expect(written).toContain("[INFO ]");
    expect(written).toContain("iteration=1");
    expect(written).toContain("stage=coder");
    expect(written).toContain("Coder started");
  });

  it("writeEvent converts progress events to log entries", async () => {
    const log = createActivityLog("s_test2");
    log.writeEvent({
      type: "coder:end",
      timestamp: "2026-02-17T10:02:00.000Z",
      iteration: 1,
      stage: "coder",
      status: "ok",
      message: "Coder completed"
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(fs.appendFile).toHaveBeenCalledTimes(1);
    const written = fs.appendFile.mock.calls[0][1];
    expect(written).toContain("Coder completed");
    expect(written).toContain("[INFO ]");
  });

  it("writeEvent uses error level for fail status", async () => {
    const log = createActivityLog("s_test3");
    log.writeEvent({
      type: "coder:end",
      timestamp: "2026-02-17T10:02:00.000Z",
      iteration: 1,
      stage: "coder",
      status: "fail",
      message: "Coder failed"
    });

    await new Promise((r) => setTimeout(r, 50));

    const written = fs.appendFile.mock.calls[0][1];
    expect(written).toContain("[ERROR]");
  });

  it("handles I/O errors gracefully without throwing", async () => {
    fs.appendFile.mockRejectedValueOnce(new Error("disk full"));
    const log = createActivityLog("s_fail");
    log.write({
      level: "info",
      timestamp: "2026-02-17T10:00:00.000Z",
      context: {},
      message: "test"
    });

    // Should not throw
    await new Promise((r) => setTimeout(r, 50));
  });
});
