import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PlannerRole } from "../src/roles/planner-role.js";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("PlannerRole", () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it("extends BaseRole and has name 'planner'", async () => {
    const role = new PlannerRole({ config: {}, logger });
    expect(role.name).toBe("planner");
  });

  it("builds prompt from task input", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: "1. Step one\n2. Step two"
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Add login feature" });
    const output = await role.run("Add login feature");

    expect(output.ok).toBe(true);
    expect(output.result.plan).toContain("Step one");
    expect(output.summary).toBeTruthy();
  });

  it("includes research context in prompt when available", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: "1. Use existing auth module"
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({
      task: "Add login",
      research: { affected_files: ["src/auth.js"], patterns: ["Factory pattern"] }
    });
    const output = await role.run("Add login");

    const prompt = fakeAgent.runTask.mock.calls[0][0].prompt;
    expect(prompt).toContain("Research findings");
    expect(prompt).toContain("src/auth.js");
    expect(output.ok).toBe(true);
  });

  it("works without research context", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: "1. Simple step"
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Fix typo" });
    const output = await role.run("Fix typo");

    const prompt = fakeAgent.runTask.mock.calls[0][0].prompt;
    expect(prompt).not.toContain("Research findings");
    expect(output.ok).toBe(true);
  });

  it("returns ok=false when agent fails", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({
        ok: false,
        error: "Agent timeout"
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Complex task" });
    const output = await role.run("Complex task");

    expect(output.ok).toBe(false);
    expect(output.result.error).toBe("Agent timeout");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "Plan done" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, emitter, createAgentFn: createAgent });
    await role.init({ task: "Task", iteration: 1 });
    await role.run("Task");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("planner");
    expect(events[1].type).toBe("end");
  });

  it("includes instructions from .md in prompt when available", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "Plan" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    // instructions are loaded during init from templates/roles/planner.md
    if (role.instructions) {
      const output = await role.run("Task");
      const prompt = fakeAgent.runTask.mock.calls[0][0].prompt;
      expect(prompt).toContain("Planner");
    }
  });

  it("report() returns structured planner report", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "1. Do X\n2. Do Y" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new PlannerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Build feature" });
    await role.run("Build feature");

    const report = role.report();
    expect(report.role).toBe("planner");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
  });

  it("resolves agent provider from config roles.planner", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "Done" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const config = { roles: { planner: { provider: "gemini" } } };
    const role = new PlannerRole({ config, logger, createAgentFn: createAgent });
    await role.init({ task: "Plan" });
    await role.run("Plan");

    expect(createAgent).toHaveBeenCalledWith("gemini", config, logger);
  });

  it("falls back to coder provider when planner not configured", async () => {
    const fakeAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "Done" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const config = { roles: { coder: { provider: "claude" } } };
    const role = new PlannerRole({ config, logger, createAgentFn: createAgent });
    await role.init({ task: "Plan" });
    await role.run("Plan");

    expect(createAgent).toHaveBeenCalledWith("claude", config, logger);
  });
});
