import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const mockRunTask = vi.fn();
const mockCreateAgent = vi.fn(() => ({ runTask: mockRunTask }));

const { TriageRole } = await import("../src/roles/triage-role.js");

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
});
