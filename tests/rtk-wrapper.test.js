import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import {
  wrapWithRtk,
  createRtkRunner,
  RtkSavingsTracker,
  RTK_SUPPORTED_COMMANDS
} from "../src/utils/rtk-wrapper.js";
import { runCommand } from "../src/utils/process.js";

describe("wrapWithRtk", () => {
  it("wraps git with rtk when available", () => {
    const result = wrapWithRtk("git", ["diff"], true);
    expect(result).toEqual({ command: "rtk", args: ["git", "diff"] });
  });

  it("returns unchanged when rtk not available", () => {
    const result = wrapWithRtk("git", ["diff"], false);
    expect(result).toEqual({ command: "git", args: ["diff"] });
  });

  it("returns unchanged for unsupported command even when rtk available", () => {
    const result = wrapWithRtk("node", ["script.js"], true);
    expect(result).toEqual({ command: "node", args: ["script.js"] });
  });

  it("wraps all whitelisted commands", () => {
    for (const cmd of RTK_SUPPORTED_COMMANDS) {
      const result = wrapWithRtk(cmd, ["arg1"], true);
      expect(result.command).toBe("rtk");
      expect(result.args[0]).toBe(cmd);
    }
  });

  it("does not wrap docker, curl, npm", () => {
    for (const cmd of ["docker", "curl", "npm", "npx", "bash"]) {
      const result = wrapWithRtk(cmd, ["arg"], true);
      expect(result.command).toBe(cmd);
    }
  });

  it("handles empty args", () => {
    const result = wrapWithRtk("git", [], true);
    expect(result).toEqual({ command: "rtk", args: ["git"] });
  });
});

describe("createRtkRunner", () => {
  it("wraps supported commands through runCommand", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "abc", stderr: "" });

    const runner = createRtkRunner(true);
    const result = await runner("git", ["diff", "HEAD"]);

    expect(runCommand).toHaveBeenCalledWith("rtk", ["git", "diff", "HEAD"], {});
    expect(result).toEqual({ exitCode: 0, stdout: "abc", stderr: "" });
  });

  it("passes through unsupported commands unchanged", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const runner = createRtkRunner(true);
    await runner("node", ["index.js"], { cwd: "/tmp" });

    expect(runCommand).toHaveBeenCalledWith("node", ["index.js"], { cwd: "/tmp" });
  });

  it("passes all commands through when rtk not available", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const runner = createRtkRunner(false);
    await runner("git", ["status"]);

    expect(runCommand).toHaveBeenCalledWith("git", ["status"], {});
  });

  it("forwards options to runCommand", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const runner = createRtkRunner(true);
    await runner("git", ["log"], { timeout: 5000 });

    expect(runCommand).toHaveBeenCalledWith("rtk", ["git", "log"], { timeout: 5000 });
  });
});

describe("RtkSavingsTracker", () => {
  it("starts at zero", () => {
    const tracker = new RtkSavingsTracker();
    const summary = tracker.summary();
    expect(summary).toEqual({
      originalBytes: 0,
      rtkBytes: 0,
      savedBytes: 0,
      savedPct: 0,
      callCount: 0
    });
  });

  it("accumulates recordings", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(1000, 600);
    tracker.record(500, 300);

    const summary = tracker.summary();
    expect(summary.originalBytes).toBe(1500);
    expect(summary.rtkBytes).toBe(900);
    expect(summary.savedBytes).toBe(600);
    expect(summary.savedPct).toBe(40);
    expect(summary.callCount).toBe(2);
  });

  it("handles zero original bytes without division error", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(0, 0);
    expect(tracker.summary().savedPct).toBe(0);
  });
});
