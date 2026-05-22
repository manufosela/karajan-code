import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { TriageRole } = await import("../../src/roles/triage-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("TriageRole", () => {
  let emitter;
  const config = {
    roles: { triage: { provider: "claude", model: null }, coder: { provider: "codex" } },
    development: {}
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "simple",
        roles: ["reviewer"],
        reasoning: "Needs a basic quality gate."
      }),
      usage: { tokens_in: 120, tokens_out: 80, cost_usd: 0.0012 }
    });
  });

  it("extends BaseRole and has name 'triage'", () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("triage");
  });

  it("requires init() before run()", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run("task")).rejects.toThrow("init() must be called before run()");
  });

  it("calls agent with triage role and parses valid JSON", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Fix typo in docs");

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", config, logger);
    expect(mockRunTask).toHaveBeenCalledWith(expect.objectContaining({ role: "triage" }));
    expect(output.ok).toBe(true);
    expect(output.result.level).toBe("simple");
    expect(output.result.roles).toEqual(["reviewer"]);
    expect(output.result.reasoning).toContain("quality gate");
  });

  it("falls back to sane defaults when JSON is invalid", async () => {
    mockRunTask.mockResolvedValue({ ok: true, output: "not-json" });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.ok).toBe(true);
    expect(output.result.level).toBe("medium");
    expect(output.result.roles).toEqual(["reviewer"]);
  });

  it("keeps and returns usage metrics for budget tracking", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.usage).toEqual(expect.objectContaining({ tokens_in: 120, tokens_out: 80 }));
  });

  it("parses shouldDecompose=true with subtasks for complex task", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "complex",
        roles: ["planner", "reviewer", "tester"],
        reasoning: "Large refactor across multiple systems.",
        shouldDecompose: true,
        subtasks: [
          "Extract auth module into separate service",
          "Update API endpoints to use new auth service",
          "Add integration tests for auth flow"
        ]
      }),
      usage: { tokens_in: 200, tokens_out: 150, cost_usd: 0.003 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Refactor the entire auth system");

    expect(output.ok).toBe(true);
    expect(output.result.shouldDecompose).toBe(true);
    expect(output.result.subtasks).toHaveLength(3);
    expect(output.result.subtasks[0]).toContain("auth module");
    expect(output.summary).toContain("decomposition recommended");
  });

  it("sets shouldDecompose=false when not present in output", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Fix typo");

    expect(output.result.shouldDecompose).toBe(false);
    expect(output.result.subtasks).toBeUndefined();
    expect(output.summary).not.toContain("decomposition");
  });

  it("ignores shouldDecompose=true when subtasks is empty", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "medium",
        roles: ["reviewer"],
        reasoning: "Moderate task.",
        shouldDecompose: true,
        subtasks: []
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Some task");

    expect(output.result.shouldDecompose).toBe(false);
    expect(output.result.subtasks).toBeUndefined();
  });

  it("truncates subtasks to max 5 entries", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "complex",
        roles: ["planner", "reviewer"],
        reasoning: "Huge task.",
        shouldDecompose: true,
        subtasks: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"]
      }),
      usage: { tokens_in: 150, tokens_out: 100, cost_usd: 0.002 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Massive refactor");

    expect(output.result.subtasks).toHaveLength(5);
  });

  it("filters out non-string subtask entries", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "complex",
        roles: ["reviewer"],
        reasoning: "Needs splitting.",
        shouldDecompose: true,
        subtasks: ["valid task", 123, null, "", "another valid task"]
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.result.subtasks).toEqual(["valid task", "another valid task"]);
  });

  it("includes decomposition info in prompt", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Some task");

    const call = mockRunTask.mock.calls[0][0];
    expect(call.prompt).toContain("decomposed");
  });

  it("parses taskType from triage output (sw)", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "medium",
        roles: ["reviewer", "tester"],
        reasoning: "Business logic task.",
        taskType: "sw"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Implement user registration");

    expect(output.result.taskType).toBe("sw");
  });

  it("parses taskType 'infra' for CI/CD tasks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "simple",
        roles: ["reviewer"],
        reasoning: "Infrastructure config.",
        taskType: "infra"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Update Docker config");

    expect(output.result.taskType).toBe("infra");
  });

  it("parses taskType 'doc' for documentation tasks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "trivial",
        roles: ["reviewer"],
        reasoning: "Documentation only.",
        taskType: "doc"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Update README");

    expect(output.result.taskType).toBe("doc");
  });

  it("parses taskType 'add-tests' for testing tasks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "medium",
        roles: ["reviewer"],
        reasoning: "Adding tests to legacy code.",
        taskType: "add-tests"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Add tests for auth module");

    expect(output.result.taskType).toBe("add-tests");
  });

  it("parses taskType 'refactor'", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "medium",
        roles: ["reviewer", "refactorer"],
        reasoning: "Pure refactor.",
        taskType: "refactor"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Refactor config module");

    expect(output.result.taskType).toBe("refactor");
  });

  it("defaults taskType to 'sw' when LLM returns invalid taskType", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        level: "medium",
        roles: ["reviewer"],
        reasoning: "Some task.",
        taskType: "invalid-type"
      }),
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Some task");

    expect(output.result.taskType).toBe("sw");
  });

  it("defaults taskType to 'sw' when LLM omits taskType", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Fix typo");

    // Default mock has no taskType field
    expect(output.result.taskType).toBe("sw");
  });

  it("defaults taskType to 'sw' in fallback (unparseable output)", async () => {
    mockRunTask.mockResolvedValue({ ok: true, output: "not-json" });

    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run("Task");

    expect(output.result.taskType).toBe("sw");
  });

  it("includes taskType in triage prompt schema", async () => {
    const role = new TriageRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run("Some task");

    const call = mockRunTask.mock.calls[0][0];
    expect(call.prompt).toContain("taskType");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new TriageRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run("Task");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("triage");
    expect(events[1].type).toBe("end");
  });

  // Resilience audit, Phase 4: triage used to fall back to safe
  // defaults SILENTLY ("Triage complete (fallback defaults)") on an
  // unparseable LLM output, so a complex task got run as a "medium"
  // pipeline with researcher/architect/security/tester skipped and
  // no warning. Now the user always learns it happened.
  describe("degraded triage (Phase 4 resilience)", () => {
    it("warns and emits 'triage:degraded' when the LLM output is not parseable", async () => {
      mockRunTask.mockResolvedValue({ ok: true, output: "this is not json" });
      const events = [];
      emitter.on("progress", (e) => events.push(e));

      const role = new TriageRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
      await role.init({});
      const output = await role.run("Task");

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.warn.mock.calls.some(([m]) => /triage/i.test(String(m)))).toBe(true);
      expect(events.some((e) => e.type === "triage:degraded")).toBe(true);
      expect(output.result.degraded).toBe(true);
      expect(output.summary).toMatch(/degraded/i);
    });

    it("does NOT warn on a clean parse (no false positives)", async () => {
      mockRunTask.mockResolvedValue({
        ok: true,
        output: JSON.stringify({ level: "complex", roles: ["coder", "reviewer"], taskType: "sw" }),
      });

      const role = new TriageRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
      await role.init({});
      const output = await role.run("Task");

      expect(logger.warn).not.toHaveBeenCalled();
      expect(output.result.degraded).toBeFalsy();
    });
  });
});
