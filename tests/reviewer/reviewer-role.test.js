import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ReviewerRole } from "../src/roles/reviewer-role.js";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("ReviewerRole", () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it("extends BaseRole and has name 'reviewer'", () => {
    const role = new ReviewerRole({ config: {}, logger });
    expect(role.name).toBe("reviewer");
  });

  it("returns approved review on successful execution", async () => {
    const reviewJson = JSON.stringify({
      approved: true,
      blocking_issues: [],
      non_blocking_suggestions: ["Consider adding JSDoc"],
      summary: "Code looks good",
      confidence: 0.95
    });
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: reviewJson })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: { review_mode: "standard" }, logger, createAgentFn: createAgent });
    await role.init({ task: "Add login" });
    const output = await role.run({ task: "Add login", diff: "diff --git a/test" });

    expect(output.ok).toBe(true);
    expect(output.result.approved).toBe(true);
    expect(output.result.blocking_issues).toHaveLength(0);
  });

  it("returns rejected review with blocking issues", async () => {
    const reviewJson = JSON.stringify({
      approved: false,
      blocking_issues: [{ id: "1", severity: "critical", file: "src/x.js", line: 10, description: "SQL injection" }],
      non_blocking_suggestions: [],
      summary: "Critical security issue",
      confidence: 0.9
    });
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: reviewJson })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Feature" });
    const output = await role.run({ task: "Feature", diff: "diff content" });

    expect(output.ok).toBe(true);
    expect(output.result.approved).toBe(false);
    expect(output.result.blocking_issues).toHaveLength(1);
    expect(output.result.blocking_issues[0].severity).toBe("critical");
  });

  it("returns ok=false when agent fails entirely", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({ ok: false, error: "Agent crashed" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    const output = await role.run({ task: "Task", diff: "diff" });

    expect(output.ok).toBe(false);
    expect(output.result.error).toContain("Agent crashed");
  });

  it("returns ok=false when agent output is not valid JSON", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: "This is not JSON at all" })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    const output = await role.run({ task: "Task", diff: "diff" });

    expect(output.ok).toBe(true);
    expect(output.result.approved).toBe(false);
    expect(output.result.blocking_issues[0].id).toBe("PARSE_ERROR");
  });

  it("includes review rules and instructions in prompt", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ approved: true, blocking_issues: [], summary: "OK", confidence: 1 })
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({
      config: { review_rules: "No console.log in production" },
      logger,
      createAgentFn: createAgent
    });
    await role.init({ task: "Task" });
    await role.run({ task: "Task", diff: "diff", reviewRules: "No console.log" });

    const prompt = fakeAgent.reviewTask.mock.calls[0][0].prompt;
    expect(prompt).toContain("No console.log");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ approved: true, blocking_issues: [], summary: "OK", confidence: 1 })
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, emitter, createAgentFn: createAgent });
    await role.init({ task: "Task", iteration: 2 });
    await role.run({ task: "Task", diff: "diff" });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("reviewer");
    expect(events[1].type).toBe("end");
  });

  it("resolves provider from config roles.reviewer", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ approved: true, blocking_issues: [], summary: "OK", confidence: 1 })
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const config = { roles: { reviewer: { provider: "claude" } } };
    const role = new ReviewerRole({ config, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    await role.run({ task: "Task", diff: "diff" });

    expect(createAgent).toHaveBeenCalledWith("claude", config, logger);
  });

  it("report() returns structured reviewer report", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ approved: true, blocking_issues: [], summary: "All good", confidence: 0.95 })
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    await role.run({ task: "Task", diff: "diff" });

    const report = role.report();
    expect(report.role).toBe("reviewer");
    expect(report.ok).toBe(true);
    expect(report.summary).toContain("Approved");
  });

  it("truncates large diffs", async () => {
    const fakeAgent = {
      reviewTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ approved: true, blocking_issues: [], summary: "OK", confidence: 1 })
      })
    };
    const createAgent = vi.fn().mockReturnValue(fakeAgent);

    const role = new ReviewerRole({ config: {}, logger, createAgentFn: createAgent });
    await role.init({ task: "Task" });
    const largeDiff = "x".repeat(15000);
    await role.run({ task: "Task", diff: largeDiff });

    const prompt = fakeAgent.reviewTask.mock.calls[0][0].prompt;
    expect(prompt).toContain("[TRUNCATED]");
  });
});
