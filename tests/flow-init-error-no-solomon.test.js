import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Regression for v2.7.5: a preflight / init failure must NOT escalate
// to Solomon. Solomon's job is to mediate coder/reviewer disputes, not
// to ask an LLM what to do about "port 9000 occupied". Pre-patch we
// invoked Solomon, which often failed to parse its own output and
// surfaced a garbled "Conflict: init_error" prompt — useless when the
// run is non-interactive (board's ▶ Run plan spawns with stdio=ignore).

const initFlowContext = vi.fn();
const invokeSolomon = vi.fn();

vi.mock("../src/orchestrator/drivers/init-context.js", () => ({
  initFlowContext: (...args) => initFlowContext(...args),
}));
vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: (...args) => invokeSolomon(...args),
}));
// Heavy modules pulled in transitively by flow-runner — stub the
// surface to keep the test focused on the init-error branch.
vi.mock("../src/orchestrator/drivers/iteration-loop.js", () => ({
  runIterationLoop: vi.fn(),
  runCoderAndRefactorerStages: vi.fn(),
  runGuardStages: vi.fn(),
  runStageWithStandby: vi.fn(),
}));
vi.mock("../src/utils/garbage-collector.js", () => ({
  runAutoGC: vi.fn().mockResolvedValue({ removed: [], errors: [] }),
  summarizeGC: vi.fn().mockReturnValue(null),
}));

beforeEach(() => {
  initFlowContext.mockReset();
  invokeSolomon.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("flow-runner: preflight/init failures fail-fast", () => {
  it("does NOT call invokeSolomon when initFlowContext throws", async () => {
    const initError = new Error("Preflight FAILED — port 9000 occupied by unknown process");
    initError.fix = "Stop the conflicting process or use sonarqube.host in kj.config.yml";
    initFlowContext.mockRejectedValue(initError);

    const { runFlow } = await import("../src/orchestrator/flow-runner.js");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    const emitter = { emit: vi.fn() };

    await expect(
      runFlow({ task: "do thing", config: {}, logger, emitter, askQuestion: vi.fn(), flags: {} })
    ).rejects.toThrow(/port 9000 occupied/);

    expect(invokeSolomon).not.toHaveBeenCalled();
  });

  it("emits an init:failed event with the error message and the fix hint", async () => {
    const initError = new Error("Docker not installed");
    initError.fix = "Install Docker: https://docs.docker.com/get-docker/";
    initFlowContext.mockRejectedValue(initError);

    const { runFlow } = await import("../src/orchestrator/flow-runner.js");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    const emitter = { emit: vi.fn() };

    await expect(
      runFlow({ task: "do thing", config: {}, logger, emitter, askQuestion: vi.fn(), flags: {} })
    ).rejects.toThrow();

    // The error + fix go to the logger as plain text…
    const errorCalls = logger.error.mock.calls.map((c) => c[0]).join(" | ");
    expect(errorCalls).toMatch(/Docker not installed/);
    expect(errorCalls).toMatch(/Install Docker/);

    // …and the structured event carries the same data for the board /
    // SSE consumers downstream.
    const initFailedEvent = emitter.emit.mock.calls.find(
      ([eventName, payload]) => eventName === "progress" && payload?.type === "init:failed"
    );
    expect(initFailedEvent).toBeDefined();
    expect(initFailedEvent[1].detail).toMatchObject({
      error: "Docker not installed",
      fix: "Install Docker: https://docs.docker.com/get-docker/",
    });
  });

  it("an init error with no fix hint still reports cleanly (no crash)", async () => {
    initFlowContext.mockRejectedValue(new Error("something exploded"));

    const { runFlow } = await import("../src/orchestrator/flow-runner.js");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    const emitter = { emit: vi.fn() };

    await expect(
      runFlow({ task: "x", config: {}, logger, emitter, askQuestion: vi.fn(), flags: {} })
    ).rejects.toThrow(/something exploded/);

    expect(invokeSolomon).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
