import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { ResearcherRole } = await import("../src/roles/researcher-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

const sampleResearchOutput = JSON.stringify({
  affected_files: ["src/auth.js", "tests/auth.test.js"],
  patterns: ["Factory pattern for agents", "ES modules"],
  constraints: ["Must keep backward compatibility"],
  prior_decisions: ["ADR-001 defines role-based architecture"],
  risks: ["Changing auth may break session handling"],
  test_coverage: "80% coverage on auth module"
});

describe("ResearcherRole", () => {
  let emitter;
  const config = {
    roles: { researcher: { provider: "claude", model: null }, coder: { provider: "claude" } },
    development: {}
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    mockRunTask.mockResolvedValue({
      ok: true,
      output: sampleResearchOutput,
      error: "",
      exitCode: 0
    });
  });

  it("extends BaseRole and has name 'researcher'", () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("researcher");
  });

  it("requires init() before run()", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run("task")).rejects.toThrow("init() must be called before run()");
  });

  it("creates agent and calls runTask on execute", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Implement login feature");

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", config, logger);
    expect(mockRunTask).toHaveBeenCalled();
    expect(output.ok).toBe(true);
  });

  it("passes task in prompt to agent", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Add authentication module");

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Add authentication module");
    expect(callArgs.role).toBe("researcher");
  });

  it("accepts string input as task shorthand", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Investigate codebase");

    expect(output.ok).toBe(true);
    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Investigate codebase");
  });

  it("accepts object input with task field", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Investigate auth" });

    expect(output.ok).toBe(true);
    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Investigate auth");
  });

  it("uses task from context when not provided in input", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({ task: "Context task" });
    await role.run({});

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Context task");
  });

  it("parses JSON output from agent into structured result", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Investigate auth");

    expect(output.result.affected_files).toEqual(["src/auth.js", "tests/auth.test.js"]);
    expect(output.result.patterns).toEqual(["Factory pattern for agents", "ES modules"]);
    expect(output.result.constraints).toEqual(["Must keep backward compatibility"]);
    expect(output.result.prior_decisions).toEqual(["ADR-001 defines role-based architecture"]);
    expect(output.result.risks).toEqual(["Changing auth may break session handling"]);
    expect(output.result.test_coverage).toBe("80% coverage on auth module");
  });

  it("handles JSON embedded in markdown code blocks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: `Here is my research:\n\`\`\`json\n${sampleResearchOutput}\n\`\`\`\nDone.`,
      error: "",
      exitCode: 0
    });

    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.ok).toBe(true);
    expect(output.result.affected_files).toEqual(["src/auth.js", "tests/auth.test.js"]);
  });

  it("returns ok=true with raw output when JSON parse fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: "No JSON here, just plain text research findings about the codebase.",
      error: "",
      exitCode: 0
    });

    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.ok).toBe(true);
    expect(output.result.raw).toContain("plain text research");
    expect(output.result.affected_files).toEqual([]);
  });

  it("returns ok=false when agent fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: false,
      output: "",
      error: "Agent timed out",
      exitCode: 1
    });

    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Agent timed out");
    expect(output.summary).toContain("failed");
  });

  it("includes provider in result", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.result.provider).toBe("claude");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new ResearcherRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run("Task");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("researcher");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when agent throws", async () => {
    mockRunTask.mockRejectedValue(new Error("Binary not found"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new ResearcherRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({});
    await expect(role.run("Task")).rejects.toThrow("Binary not found");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Binary not found");
  });

  it("report() returns structured researcher report", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Investigate");

    const report = role.report();
    expect(report.role).toBe("researcher");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("resolves provider from config.roles.researcher.provider", async () => {
    const customConfig = {
      roles: { researcher: { provider: "codex" } },
      development: {}
    };

    const role = new ResearcherRole({ config: customConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("codex", customConfig, logger);
  });

  it("falls back to coder provider when researcher provider is null", async () => {
    const fallbackConfig = {
      roles: { researcher: { provider: null }, coder: { provider: "gemini" } },
      development: {}
    };

    const role = new ResearcherRole({ config: fallbackConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", fallbackConfig, logger);
  });

  it("defaults to 'claude' when no provider configured", async () => {
    const minConfig = { roles: {}, development: {} };

    const role = new ResearcherRole({ config: minConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Task");

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", minConfig, logger);
  });

  it("works without emitter", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.ok).toBe(true);
  });

  it("generates meaningful summary from parsed research", async () => {
    const role = new ResearcherRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.summary).toContain("2 files");
    expect(output.summary).toContain("1 risk");
  });
});
