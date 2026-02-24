import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { BaseRole, ROLE_EVENTS } from "../src/roles/base-role.js";

class TestRole extends BaseRole {
  async execute(input) {
    return { ok: true, result: { echo: input }, summary: "Test done" };
  }
}

class FailingRole extends BaseRole {
  async execute() {
    throw new Error("Something broke");
  }
}

class BadOutputRole extends BaseRole {
  async execute() {
    return { notOk: true };
  }
}

describe("BaseRole", () => {
  let emitter;
  let logger;

  beforeEach(() => {
    emitter = new EventEmitter();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
  });

  it("throws if execute() is not implemented", async () => {
    const role = new BaseRole({ name: "abstract", config: {}, logger });
    await role.init();
    await expect(role.run("test")).rejects.toThrow("execute() not implemented");
  });

  it("throws if run() called before init()", async () => {
    const role = new TestRole({ name: "test", config: {}, logger });
    await expect(role.run("input")).rejects.toThrow("init() must be called before run()");
  });

  it("throws if name is missing", () => {
    expect(() => new BaseRole({ config: {}, logger })).toThrow("Role name is required");
  });

  it("executes a role and returns output", async () => {
    const role = new TestRole({ name: "test", config: {}, logger, emitter });
    await role.init({ sessionId: "s1", iteration: 1 });
    const output = await role.run("hello");
    expect(output.ok).toBe(true);
    expect(output.result.echo).toBe("hello");
    expect(output.summary).toBe("Test done");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new TestRole({ name: "test", config: {}, logger, emitter });
    await role.init({ sessionId: "s1", iteration: 2 });
    await role.run("input");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("test");
    expect(events[0].iteration).toBe(2);
    expect(events[1].type).toBe("end");
    expect(events[1].role).toBe("test");
  });

  it("emits role:error on execute failure", async () => {
    const errors = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => errors.push(e));

    const role = new FailingRole({ name: "failing", config: {}, logger, emitter });
    await role.init();
    await expect(role.run("input")).rejects.toThrow("Something broke");

    expect(errors).toHaveLength(1);
    expect(errors[0].role).toBe("failing");
    expect(errors[0].error).toBe("Something broke");
  });

  it("emits role:error on validation failure", async () => {
    const errors = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => errors.push(e));

    const role = new BadOutputRole({ name: "bad", config: {}, logger, emitter });
    await role.init();
    await expect(role.run("input")).rejects.toThrow("output validation failed");

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain("Output.ok must be a boolean");
  });

  it("generates a report after successful execution", async () => {
    const role = new TestRole({ name: "reporter", config: {}, logger });
    await role.init();
    await role.run("data");

    const report = role.report();
    expect(report.role).toBe("reporter");
    expect(report.ok).toBe(true);
    expect(report.summary).toBe("Test done");
    expect(report.timestamp).toBeTruthy();
  });

  it("validate() accepts valid output", () => {
    const role = new BaseRole({ name: "v", config: {}, logger });
    expect(role.validate({ ok: true }).valid).toBe(true);
    expect(role.validate({ ok: false }).valid).toBe(true);
  });

  it("validate() rejects null output", () => {
    const role = new BaseRole({ name: "v", config: {}, logger });
    expect(role.validate(null).valid).toBe(false);
  });

  it("validate() rejects output without ok boolean", () => {
    const role = new BaseRole({ name: "v", config: {}, logger });
    expect(role.validate({ ok: "yes" }).valid).toBe(false);
  });

  it("works without emitter (no events, no crash)", async () => {
    const role = new TestRole({ name: "silent", config: {}, logger });
    await role.init();
    const output = await role.run("data");
    expect(output.ok).toBe(true);
  });
});
