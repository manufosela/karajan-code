import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { CoderRole } = await import("../src/roles/coder-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("CoderRole", () => {
  let emitter;
  const config = {
    roles: { coder: { provider: "claude", model: null } },
    coder: "claude",
    development: { methodology: "tdd" }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    mockRunTask.mockResolvedValue({
      ok: true,
      output: "Changes applied successfully",
      error: "",
      exitCode: 0
    });
  });

  it("extends BaseRole and has name 'coder'", () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("coder");
  });

  it("requires init() before run()", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run({ task: "test" })).rejects.toThrow("init() must be called before run()");
  });

  it("creates agent and calls runTask on execute", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Add login feature" });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", config, logger);
    expect(mockRunTask).toHaveBeenCalled();
    expect(output.ok).toBe(true);
  });

  it("passes prompt with task to agent", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Add login feature" });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Add login feature");
    expect(callArgs.role).toBe("coder");
  });

  it("includes reviewer feedback in prompt when provided", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({
      task: "Fix bug",
      reviewerFeedback: "Missing null check on line 42"
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Missing null check on line 42");
  });

  it("includes sonar summary in prompt when provided", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({
      task: "Fix sonar issues",
      sonarSummary: "QualityGate=ERROR; CRITICAL: 2"
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("QualityGate=ERROR; CRITICAL: 2");
  });

  it("includes TDD methodology in prompt by default", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Add feature" });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("TDD");
  });

  it("accepts string input as task shorthand", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Add login feature");

    expect(output.ok).toBe(true);
    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Add login feature");
  });

  it("uses task from context when not provided in input", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({ task: "Context task" });
    await role.run({});

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Context task");
  });

  it("returns ok=false when agent fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: false,
      output: "",
      error: "Process timed out",
      exitCode: 1
    });

    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Add feature" });

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Process timed out");
    expect(output.summary).toContain("failed");
  });

  it("returns output from agent in result", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: "Modified src/auth.js and added tests",
      error: "",
      exitCode: 0
    });

    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Add auth" });

    expect(output.ok).toBe(true);
    expect(output.result.output).toBe("Modified src/auth.js and added tests");
  });

  it("forwards onOutput callback to agent", async () => {
    const onOutput = vi.fn();
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Add feature", onOutput });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.onOutput).toBe(onOutput);
  });

  it("does not pass onOutput when not provided", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Add feature" });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.onOutput).toBeUndefined();
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new CoderRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run({ task: "Task" });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("coder");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when agent throws", async () => {
    mockRunTask.mockRejectedValue(new Error("Agent binary not found"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new CoderRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({});
    await expect(role.run({ task: "Task" })).rejects.toThrow("Agent binary not found");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Agent binary not found");
  });

  it("report() returns structured coder report", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Build feature" });

    const report = role.report();
    expect(report.role).toBe("coder");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("resolves provider from config.roles.coder.provider", async () => {
    const customConfig = {
      roles: { coder: { provider: "codex", model: null } },
      development: { methodology: "standard" }
    };

    const role = new CoderRole({ config: customConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Task" });

    expect(mockCreateAgent).toHaveBeenCalledWith("codex", customConfig, logger);
  });

  it("falls back to config.coder when roles.coder.provider is null", async () => {
    const legacyConfig = {
      roles: { coder: { provider: null } },
      coder: "gemini",
      development: { methodology: "tdd" }
    };

    const role = new CoderRole({ config: legacyConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Task" });

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", legacyConfig, logger);
  });

  it("defaults to 'claude' when no provider configured", async () => {
    const minConfig = { roles: {}, development: {} };

    const role = new CoderRole({ config: minConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Task" });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", minConfig, logger);
  });

  it("works without emitter", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Task" });

    expect(output.ok).toBe(true);
  });

  it("includes provider in result", async () => {
    const role = new CoderRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Task" });

    expect(output.result.provider).toBe("claude");
  });
});
