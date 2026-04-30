import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/utils/process.js";

describe("runCommand timeout handling", () => {
  it("returns timeout error with stderr when command exceeds timeout", async () => {
    const result = await runCommand("sleep", ["10"], { timeout: 200 });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
    // Either our own timeout message or execa's killed result
    const isTimeout = result.timedOut || result.stderr.includes("timed out") || result.stderr.includes("killed");
    expect(isTimeout).toBe(true);
  });

  it("preserves accumulated stdout on timeout", async () => {
    const result = await runCommand("bash", ["-c", "echo partial_output; sleep 10"], { timeout: 1000 });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("partial_output");
  });

  it("does not timeout when command completes within limit", async () => {
    const result = await runCommand("echo", ["fast"], { timeout: 10000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("fast");
  });

  it("reports signal when process is killed by timeout", async () => {
    const result = await runCommand("sleep", ["10"], { timeout: 200 });

    // Signal should be present (SIGTERM or SIGKILL depending on timing)
    expect(result.signal).toBeTruthy();
  });

  // regression-for: regression
  it("works without timeout (no regression)", async () => {
    const result = await runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });
});

describe("runCommand enrichResult for killed processes", () => {
  it("adds stderr message when process killed by signal has no stderr", async () => {
    // A quick sleep killed by our timeout should have enriched stderr
    const result = await runCommand("sleep", ["10"], { timeout: 200 });

    expect(result.stderr).toBeTruthy();
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("does not overwrite stderr for normal failures", async () => {
    const result = await runCommand("bash", ["-c", "echo error_msg >&2; exit 1"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error_msg");
  });
});

describe("run-kj resolveTimeout", () => {
  it("module exports runKjCommand", async () => {
    const { runKjCommand } = await import("../src/mcp/run-kj.js");
    expect(typeof runKjCommand).toBe("function");
  });
});

describe("config default max_iteration_minutes", () => {
  it("defaults to 30 minutes when no yml override exists", async () => {
    vi.resetModules();
    vi.doMock("../src/utils/fs.js", () => ({
      exists: vi.fn().mockResolvedValue(false),
      ensureDir: vi.fn().mockResolvedValue(undefined),
    }));
    const { loadConfig } = await import("../src/config.js");
    const { config } = await loadConfig();
    expect(config.session.max_iteration_minutes).toBe(30);
  });
});
