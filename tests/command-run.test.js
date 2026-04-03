import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/orchestrator.js", () => ({
  runFlow: vi.fn()
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role
  }))
}));

vi.mock("../src/activity-log.js", () => ({
  createActivityLog: vi.fn(() => ({
    write: vi.fn(),
    writeEvent: vi.fn()
  }))
}));

vi.mock("../src/utils/display.js", () => ({
  printHeader: vi.fn(),
  printEvent: vi.fn()
}));

function makeConfig(overrides = {}) {
  return {
    roles: {
      coder: { provider: "codex" },
      reviewer: { provider: "claude" },
      planner: { provider: null },
      refactorer: { provider: null }
    },
    pipeline: { planner: { enabled: false }, refactorer: { enabled: false } },
    reviewer_options: { fallback_reviewer: "codex" },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  setContext: vi.fn(), onLog: vi.fn()
};

describe("commands/run", () => {
  let runFlow, assertAgentsAvailable, printHeader, printEvent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const orch = await import("../src/orchestrator.js");
    runFlow = orch.runFlow;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const display = await import("../src/utils/display.js");
    printHeader = display.printHeader;
    printEvent = display.printEvent;

    runFlow.mockResolvedValue({ approved: true, sessionId: "s1" });
  });

  it("calls assertAgentsAvailable with required providers", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig({ reviewer_options: { fallback_reviewer: "codex" } });
    await runCommandHandler({ task: "test task", config, logger: noopLogger, flags: {} });

    // Should only require primary providers (codex for coder, claude for reviewer)
    expect(assertAgentsAvailable).toHaveBeenCalledWith(
      expect.arrayContaining(["codex", "claude"])
    );
  });

  it("does not require codex fallback if coder is something else", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig({
      roles: {
        coder: { provider: "gemini" },
        reviewer: { provider: "gemini" }
      },
      reviewer_options: { fallback_reviewer: "codex" }
    });
    await runCommandHandler({ task: "test task", config, logger: noopLogger, flags: {} });

    const call = vi.mocked(assertAgentsAvailable).mock.calls[0][0];
    expect(call).toContain("gemini");
    expect(call).not.toContain("codex");
  });

  it("includes planner provider when planner is enabled", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig({
      pipeline: { planner: { enabled: true }, refactorer: { enabled: false } },
      roles: {
        coder: { provider: "codex" },
        reviewer: { provider: "claude" },
        planner: { provider: "claude" },
        refactorer: { provider: null }
      }
    });
    await runCommandHandler({ task: "test task", config, logger: noopLogger, flags: {} });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(
      expect.arrayContaining(["claude"])
    );
  });

  it("calls runFlow with task, config, logger, flags, and emitter", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig();
    await runCommandHandler({ task: "do something", config, logger: noopLogger, flags: { dryRun: true } });

    expect(runFlow).toHaveBeenCalledWith(expect.objectContaining({
      task: "do something",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    }));
  });

  it("prints header and events in normal mode", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig();
    await runCommandHandler({ task: "test", config, logger: noopLogger, flags: {} });

    expect(printHeader).toHaveBeenCalledWith({ task: "test", config });
  });

  it("does not print header in json mode", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommandHandler({ task: "test", config, logger: noopLogger, flags: { json: true } });

    expect(printHeader).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("outputs JSON result in json mode", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig();
    runFlow.mockResolvedValue({ approved: true, sessionId: "s1" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommandHandler({ task: "test", config, logger: noopLogger, flags: { json: true } });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("approved"));
    consoleSpy.mockRestore();
  });

  it("propagates runFlow errors", async () => {
    const { runCommandHandler } = await import("../src/commands/run.js");
    const config = makeConfig();
    runFlow.mockRejectedValue(new Error("orchestrator failed"));

    await expect(
      runCommandHandler({ task: "test", config, logger: noopLogger, flags: {} })
    ).rejects.toThrow("orchestrator failed");
  });
});
