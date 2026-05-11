import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { SolomonRole } = await import("../src/roles/solomon-role.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

const approveRuling = JSON.stringify({
  ruling: "approve",
  classification: [
    { issue: "Variable naming", category: "style", action: "dismiss" }
  ],
  conditions: [],
  dismissed: ["Variable naming — stylistic preference"],
  escalate: false,
  subtask: null
});

const approveWithConditionsRuling = JSON.stringify({
  ruling: "approve_with_conditions",
  classification: [
    { issue: "Missing null check in processUser()", category: "critical", action: "must_fix" },
    { issue: "Naming convention", category: "style", action: "dismiss" }
  ],
  conditions: ["Add null check in processUser() at line 42"],
  dismissed: ["Naming convention — not blocking"],
  escalate: false,
  subtask: null
});

const escalateRuling = JSON.stringify({
  ruling: "escalate_human",
  classification: [
    { issue: "Architecture change needed", category: "critical", action: "must_fix" }
  ],
  conditions: [],
  dismissed: [],
  escalate: true,
  escalate_reason: "Requires architectural decision beyond agent scope",
  subtask: null
});

const subtaskRuling = JSON.stringify({
  ruling: "create_subtask",
  classification: [
    { issue: "Missing shared utility", category: "important", action: "must_fix" }
  ],
  conditions: [],
  dismissed: [],
  escalate: false,
  subtask: {
    title: "Extract shared validation utility",
    description: "Create a shared validation module to resolve the circular dependency causing the conflict",
    reason: "Both Coder and Reviewer agree validation is needed but disagree on location"
  }
});

describe("SolomonRole", () => {
  let emitter;
  const config = {
    roles: { solomon: { provider: "gemini" }, coder: { provider: "claude" } },
    development: {},
    session: {
      max_sonar_retries: 3,
      max_reviewer_retries: 3,
      max_tester_retries: 1,
      max_security_retries: 1
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    mockRunTask.mockResolvedValue({
      ok: true,
      output: approveRuling,
      error: "",
      exitCode: 0
    });
  });

  it("extends BaseRole and has name 'solomon'", () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    expect(role.name).toBe("solomon");
  });

  it("requires init() before run()", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await expect(role.run({ conflict: {} })).rejects.toThrow("init() must be called before run()");
  });

  it("creates agent and calls runTask on execute", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", config, logger);
    expect(mockRunTask).toHaveBeenCalled();
    expect(output.ok).toBe(true);
  });

  it("passes conflict context in prompt to agent", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({ task: "Implement auth module" });
    await role.run({
      conflict: {
        stage: "reviewer",
        history: [{ agent: "reviewer", feedback: "Missing null check" }],
        diff: "diff --git a/src/auth.js"
      }
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Missing null check");
    expect(callArgs.prompt).toContain("diff --git a/src/auth.js");
    expect(callArgs.prompt).toContain("Implement auth module");
    expect(callArgs.role).toBe("solomon");
  });

  // --- Ruling: approve ---

  it("returns ok=true with ruling=approve when all issues are style", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(true);
    expect(output.result.ruling).toBe("approve");
    expect(output.result.dismissed).toHaveLength(1);
    expect(output.result.escalate).toBe(false);
  });

  // --- Ruling: approve_with_conditions ---

  it("returns ok=true with conditions when ruling=approve_with_conditions", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: approveWithConditionsRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(true);
    expect(output.result.ruling).toBe("approve_with_conditions");
    expect(output.result.conditions).toHaveLength(1);
    expect(output.result.conditions[0]).toContain("null check");
  });

  // --- Ruling: escalate_human ---

  it("returns ok=false with escalate=true when ruling=escalate_human", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: escalateRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(false);
    expect(output.result.ruling).toBe("escalate_human");
    expect(output.result.escalate).toBe(true);
    expect(output.result.escalate_reason).toContain("architectural");
  });

  // --- Ruling: create_subtask ---

  it("returns ok=true with subtask when ruling=create_subtask", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: subtaskRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "sonar", history: [] } });

    expect(output.ok).toBe(true);
    expect(output.result.ruling).toBe("create_subtask");
    expect(output.result.subtask).toBeTruthy();
    expect(output.result.subtask.title).toContain("validation utility");
    expect(output.result.subtask.description).toBeTruthy();
    expect(output.result.subtask.reason).toBeTruthy();
  });

  // --- Classification parsing ---

  it("parses classification with full structure", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: approveWithConditionsRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    const classification = output.result.classification;
    expect(classification).toHaveLength(2);
    expect(classification[0].category).toBe("critical");
    expect(classification[0].action).toBe("must_fix");
    expect(classification[1].category).toBe("style");
    expect(classification[1].action).toBe("dismiss");
  });

  // --- Agent failure ---

  it("returns ok=false when agent fails", async () => {
    mockRunTask.mockResolvedValue({
      ok: false,
      output: "",
      error: "Agent timed out",
      exitCode: 1
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Agent timed out");
    expect(output.summary).toContain("failed");
  });

  // --- JSON parsing ---

  it("handles JSON embedded in markdown code blocks", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: `Here is my ruling:\n\`\`\`json\n${approveRuling}\n\`\`\``,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(true);
    expect(output.result.ruling).toBe("approve");
  });

  it("returns ok=false with parse error when no JSON found", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: "I think the code looks fine, approve it.",
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(false);
    expect(output.summary).toContain("parse error");
  });

  // --- Provider resolution ---

  it("resolves provider from config.roles.solomon.provider", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(mockCreateAgent).toHaveBeenCalledWith("gemini", config, logger);
  });

  it("falls back to coder provider when solomon provider is null", async () => {
    const fallbackConfig = {
      roles: { solomon: { provider: null }, coder: { provider: "claude" } },
      development: {},
      session: {}
    };

    const role = new SolomonRole({ config: fallbackConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", fallbackConfig, logger);
  });

  it("defaults to 'claude' when no provider configured", async () => {
    const minConfig = { roles: {}, development: {}, session: {} };

    const role = new SolomonRole({ config: minConfig, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(mockCreateAgent).toHaveBeenCalledWith("claude", minConfig, logger);
  });

  // --- Summary generation ---

  it("generates meaningful summary for approve ruling", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.summary).toContain("Approved");
    expect(output.summary).toContain("1 dismissed");
  });

  it("generates meaningful summary for approve_with_conditions", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: approveWithConditionsRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.summary).toContain("Approved with 1 condition");
    expect(output.summary).toContain("1 dismissed");
  });

  it("generates summary for escalate ruling", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: escalateRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.summary).toContain("Escalated to human");
  });

  it("generates summary for create_subtask ruling", async () => {
    mockRunTask.mockResolvedValue({
      ok: true,
      output: subtaskRuling,
      error: "",
      exitCode: 0
    });

    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "sonar", history: [] } });

    expect(output.summary).toContain("Subtask created");
    expect(output.summary).toContain("validation utility");
  });

  // --- Events ---

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new SolomonRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({ iteration: 1 });
    await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("solomon");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when agent throws", async () => {
    mockRunTask.mockRejectedValue(new Error("Binary not found"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new SolomonRole({ config, logger, emitter, createAgentFn: mockCreateAgent });
    await role.init({});
    await expect(role.run({ conflict: { stage: "reviewer", history: [] } })).rejects.toThrow("Binary not found");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Binary not found");
  });

  // --- report() ---

  it("report() returns structured solomon report", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({ conflict: { stage: "reviewer", history: [] } });

    const report = role.report();
    expect(report.role).toBe("solomon");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  // --- Works without emitter ---

  it("works without emitter", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({ conflict: { stage: "reviewer", history: [] } });

    expect(output.ok).toBe(true);
  });

  // --- Conflict stage in prompt ---

  it("includes conflict stage in prompt", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({
      conflict: {
        stage: "sonar",
        history: [{ agent: "sonar", feedback: "BLOCKER: SQL injection" }]
      }
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("sonar");
    expect(callArgs.prompt).toContain("SQL injection");
  });

  // --- Includes iteration limits context ---

  it("includes iteration config context in prompt", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    await role.run({
      conflict: {
        stage: "reviewer",
        iterationCount: 3,
        maxIterations: 3,
        history: []
      }
    });

    const callArgs = mockRunTask.mock.calls[0][0];
    expect(callArgs.prompt).toContain("3");
  });

  // --- Handles missing conflict gracefully ---

  it("handles missing conflict input gracefully", async () => {
    const role = new SolomonRole({ config, logger, createAgentFn: mockCreateAgent });
    await role.init({});
    const output = await role.run({});

    expect(output.ok).toBe(true);
    expect(mockRunTask).toHaveBeenCalled();
  });
});
