import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { SecurityRole } = await import("../src/roles/security-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

const samplePassOutput = JSON.stringify({
  vulnerabilities: [],
  verdict: "pass"
});

const sampleFailOutput = JSON.stringify({
  vulnerabilities: [
    {
      severity: "critical",
      category: "injection",
      file: "src/api/handler.js",
      line: 42,
      description: "User input passed directly to shell command",
      fix_suggestion: "Use parameterized execution or sanitize input"
    },
    {
      severity: "high",
      category: "secrets",
      file: "src/config.js",
      line: 10,
      description: "Hardcoded API key",
      fix_suggestion: "Use environment variable"
    }
  ],
  verdict: "fail"
});

describe("SecurityRole", () => {
  let emitter;
  const config = {
    roles: { security: { provider: "claude", model: null }, coder: { provider: "claude" } },
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

  it("extends BaseRole and has name 'security'", () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("security");
  });

  it("requires init() before run()", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run({ task: "audit" })).rejects.toThrow("init() must be called before run()");
  });

  it("creates agent and calls runTask on execute", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ task: "Audit auth module", diff: "some diff" });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", config, logger);
    expect(mockRunTask).toHaveBeenCalled();
    expect(output.ok).toBe(true);
  });

  it("passes task and diff in prompt to agent", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ task: "Audit changes", diff: "diff --git a/src/api.js" });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Audit changes");
    expect(callArgs.prompt).toContain("diff --git a/src/api.js");
    expect(callArgs.role).toBe("security");
  });

  it("accepts string input as task shorthand", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit code for vulnerabilities");

    expect(output.ok).toBe(true);
    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Audit code for vulnerabilities");
  });

  it("uses task from context when not provided", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({ task: "Context task" });
    await role.run({});

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Context task");
  });

  it("returns ok=true when verdict is pass", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(true);
    expect(output.result.verdict).toBe("pass");
    expect(output.result.vulnerabilities).toHaveLength(0);
  });

  it("returns ok=false when verdict is fail", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: sampleFailOutput,
      error: "",
      exitCode: 0
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(false);
    expect(output.result.verdict).toBe("fail");
    expect(output.result.vulnerabilities).toHaveLength(2);
  });

  it("parses vulnerabilities with full structure", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: sampleFailOutput,
      error: "",
      exitCode: 0
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    const vuln = output.result.vulnerabilities[0];
    expect(vuln.severity).toBe("critical");
    expect(vuln.category).toBe("injection");
    expect(vuln.file).toBe("src/api/handler.js");
    expect(vuln.line).toBe(42);
    expect(vuln.description).toContain("shell command");
    expect(vuln.fix_suggestion).toContain("sanitize");
  });

  it("returns ok=false when agent fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: false,
      output: "",
      error: "Agent timed out",
      exitCode: 1
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Agent timed out");
    expect(output.summary).toContain("failed");
  });

  it("handles JSON embedded in markdown code blocks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: `Results:\n\`\`\`json\n${samplePassOutput}\n\`\`\``,
      error: "",
      exitCode: 0
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(true);
    expect(output.result.verdict).toBe("pass");
  });

  it("returns ok=false with parse error when JSON is invalid", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: "No vulnerabilities found in plain text.",
      error: "",
      exitCode: 0
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(false);
    expect(output.summary).toContain("parse error");
  });

  it("includes provider in result", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.result.provider).toBe("claude");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new SecurityRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run("Audit");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("security");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when agent throws", async () => {
    mockRunTask.mockRejectedValue(new Error("Binary not found"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new SecurityRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({});
    await expect(role.run("Audit")).rejects.toThrow("Binary not found");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Binary not found");
  });

  it("report() returns structured security report", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Audit");

    const report = role.report();
    expect(report.role).toBe("security");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("resolves provider from config.roles.security.provider", async () => {
    const customConfig = {
      roles: { security: { provider: "codex" } },
      development: {}
    };

    const role = new SecurityRole({ config: customConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Audit");

    expect(mockCreateAgent).toHaveBeenCalledWith("codex", customConfig, logger);
  });

  it("falls back to coder provider when security provider is null", async () => {
    const fallbackConfig = {
      roles: { security: { provider: null }, coder: { provider: "gemini" } },
      development: {}
    };

    const role = new SecurityRole({ config: fallbackConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Audit");

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", fallbackConfig, logger);
  });

  it("defaults to 'claude' when no provider configured", async () => {
    const minConfig = { roles: {}, development: {} };

    const role = new SecurityRole({ config: minConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Audit");

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", minConfig, logger);
  });

  it("generates meaningful summary with vulnerability counts", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: sampleFailOutput,
      error: "",
      exitCode: 0
    });

    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.summary).toContain("fail");
    expect(output.summary).toContain("1 critical");
    expect(output.summary).toContain("1 high");
  });

  it("works without emitter", async () => {
    const role = new SecurityRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Audit");

    expect(output.ok).toBe(true);
  });
});
