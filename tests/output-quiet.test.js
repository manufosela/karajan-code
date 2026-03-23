import { describe, expect, it, vi, beforeEach } from "vitest";
import { printEvent, formatElapsed } from "../src/utils/display.js";
import { applyRunOverrides } from "../src/config.js";

// Capture console.log output
let logOutput;

beforeEach(() => {
  logOutput = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    logOutput.push(args.join(" "));
  });
});

describe("printEvent quiet mode", () => {
  it("suppresses agent:output events when quiet=true", () => {
    const event = {
      type: "agent:output",
      message: "some raw agent line",
      detail: { stream: "stdout", agent: "claude" }
    };
    printEvent(event, { quiet: true });
    expect(logOutput).toHaveLength(0);
  });

  it("shows agent:output events when quiet=false (verbose)", () => {
    const event = {
      type: "agent:output",
      message: "some raw agent line",
      detail: { stream: "stdout", agent: "claude" }
    };
    printEvent(event, { quiet: false });
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toContain("some raw agent line");
  });

  it("shows agent:output events when opts is empty (backward compat)", () => {
    const event = {
      type: "agent:output",
      message: "some raw agent line",
      detail: { stream: "stdout", agent: "claude" }
    };
    printEvent(event);
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toContain("some raw agent line");
  });

  it("still shows stage events in quiet mode", () => {
    const stageEvents = [
      { type: "coder:start", detail: { coder: "claude" } },
      { type: "coder:end", status: "ok", elapsed: 5000 },
      { type: "sonar:start" },
      { type: "sonar:end", detail: { gateStatus: "OK" }, elapsed: 3000 },
      { type: "reviewer:start", detail: { reviewer: "codex" } },
      { type: "reviewer:end", detail: { approved: true }, elapsed: 4000 },
      { type: "iteration:start", detail: { iteration: 1, maxIterations: 5 } },
      { type: "iteration:end", detail: { duration: 12000 }, elapsed: 12000 },
      { type: "session:end", detail: { approved: true }, elapsed: 15000 }
    ];

    for (const event of stageEvents) {
      printEvent(event, { quiet: true });
    }

    // All stage events should produce output
    expect(logOutput.length).toBeGreaterThanOrEqual(stageEvents.length);
  });
});

describe("config quiet/verbose flags", () => {
  const baseConfig = {
    coder: "claude",
    reviewer: "codex",
    review_mode: "standard",
    max_iterations: 5,
    development: { methodology: "tdd", require_test_changes: true },
    output: { report_dir: "./.reviews", log_level: "info", quiet: true },
    roles: {},
    pipeline: {},
    session: {},
    git: {},
    sonarqube: {},
    budget: {}
  };

  it("defaults to quiet=true", () => {
    const result = applyRunOverrides(baseConfig, {});
    expect(result.output.quiet).toBe(true);
  });

  it("--verbose sets quiet=false", () => {
    const result = applyRunOverrides(baseConfig, { verbose: true });
    expect(result.output.quiet).toBe(false);
  });

  it("--quiet explicitly sets quiet=true", () => {
    const startConfig = { ...baseConfig, output: { ...baseConfig.output, quiet: false } };
    const result = applyRunOverrides(startConfig, { quiet: true });
    expect(result.output.quiet).toBe(true);
  });

  it("--verbose overrides default quiet", () => {
    const result = applyRunOverrides(baseConfig, { verbose: true });
    expect(result.output.quiet).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("formats milliseconds correctly", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5000)).toBe("00:05");
    expect(formatElapsed(65000)).toBe("01:05");
    expect(formatElapsed(135000)).toBe("02:15");
  });
});
