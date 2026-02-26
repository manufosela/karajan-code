import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { TesterRole } = await import("../src/roles/tester-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

const samplePassOutput = JSON.stringify({
  tests_pass: true,
  coverage: { overall: 85, services: 82, utilities: 91 },
  missing_scenarios: ["Error handling for network timeout not tested"],
  quality_issues: [],
  verdict: "pass"
});

const sampleFailOutput = JSON.stringify({
  tests_pass: false,
  coverage: { overall: 60, services: 55, utilities: 70 },
  missing_scenarios: ["Auth module has no tests"],
  quality_issues: ["Tests use shared mutable state in describe block"],
  verdict: "fail"
});

describe("TesterRole", () => {
  let emitter;
  const config = {
    roles: { tester: { provider: "claude", model: null }, coder: { provider: "claude" } },
    development: {}
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    mockRunTask.mockResolvedValue({
      ok: true,
      output: samplePassOutput,
      error: "",
      exitCode: 0
    });
  });

  it("extends BaseRole and has name 'tester'", () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("tester");
  });

  it("requires init() before run()", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run({ task: "test" })).rejects.toThrow("init() must be called before run()");
  });

  it("creates agent and calls runTask on execute", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Evaluate tests for auth module" });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", config, logger);
    expect(mockRunTask).toHaveBeenCalled();
    expect(output.ok).toBe(true);
  });

  it("passes task and diff in prompt to agent", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Evaluate auth tests", diff: "diff --git a/src/auth.js" });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Evaluate auth tests");
    expect(callArgs.prompt).toContain("diff --git a/src/auth.js");
    expect(callArgs.role).toBe("tester");
  });

  it("accepts string input as task shorthand", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check test quality");

    expect(output.ok).toBe(true);
    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Check test quality");
  });

  it("uses task from context when not provided", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({ task: "Context task" });
    await role.run({});

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Context task");
  });

  it("parses JSON output with passing verdict", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.ok).toBe(true);
    expect(output.result.tests_pass).toBe(true);
    expect(output.result.verdict).toBe("pass");
    expect(output.result.coverage).toEqual({ overall: 85, services: 82, utilities: 91 });
    expect(output.result.missing_scenarios).toHaveLength(1);
    expect(output.result.quality_issues).toHaveLength(0);
  });

  it("returns ok=false when verdict is fail", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: sampleFailOutput,
      error: "",
      exitCode: 0
    });

    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.ok).toBe(false);
    expect(output.result.tests_pass).toBe(false);
    expect(output.result.verdict).toBe("fail");
    expect(output.result.coverage.overall).toBe(60);
    expect(output.result.quality_issues).toHaveLength(1);
  });

  it("returns ok=false when agent fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: false,
      output: "",
      error: "Agent timed out",
      exitCode: 1
    });

    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Agent timed out");
    expect(output.summary).toContain("failed");
  });

  it("handles JSON embedded in markdown code blocks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: `Here are the results:\n\`\`\`json\n${samplePassOutput}\n\`\`\``,
      error: "",
      exitCode: 0
    });

    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.ok).toBe(true);
    expect(output.result.tests_pass).toBe(true);
  });

  it("returns ok=false with parse error when JSON is invalid", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: "No JSON here, just plain text about tests.",
      error: "",
      exitCode: 0
    });

    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.ok).toBe(false);
    expect(output.summary).toContain("parse error");
  });

  it("includes sonar issues in prompt when provided", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({
      task: "Check tests",
      sonarIssues: "MAJOR: Test file has code smell on line 15"
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("MAJOR: Test file has code smell on line 15");
  });

  it("includes provider in result", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Check tests");

    expect(output.result.provider).toBe("claude");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new TesterRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run("Check tests");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("tester");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when agent throws", async () => {
    mockRunTask.mockRejectedValue(new Error("Binary not found"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new TesterRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({});
    await expect(role.run("Check tests")).rejects.toThrow("Binary not found");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Binary not found");
  });

  it("report() returns structured tester report", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Check tests");

    const report = role.report();
    expect(report.role).toBe("tester");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("resolves provider from config.roles.tester.provider", async () => {
    const customConfig = {
      roles: { tester: { provider: "codex" } },
      development: {}
    };

    const role = new TesterRole({ config: customConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("codex", customConfig, logger);
  });

  it("falls back to coder provider when tester provider is null", async () => {
    const fallbackConfig = {
      roles: { tester: { provider: null }, coder: { provider: "gemini" } },
      development: {}
    };

    const role = new TesterRole({ config: fallbackConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", fallbackConfig, logger);
  });

  it("defaults to 'claude' when no provider configured", async () => {
    const minConfig = { roles: {}, development: {} };

    const role = new TesterRole({ config: minConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", minConfig, logger);
  });

  it("generates meaningful summary from parsed result", async () => {
    const role = new TesterRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.summary).toContain("pass");
    expect(output.summary).toContain("85%");
  });
});
