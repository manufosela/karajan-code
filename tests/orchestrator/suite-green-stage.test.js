// KJC-BUG-0298 (#1993): with TDD, a red suite never reaches the reviewer. The
// stage runs the project's own test command and hands a red suite to the coder.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/session/store.js", () => ({ addCheckpoint: vi.fn(async () => {}), saveSession: vi.fn(async () => {}) }));

const { runSuiteGreenStage } = await import("../../src/orchestrator/stages/suite-green-stage.js");

const base = () => {
  const events = [];
  return {
    events,
    args: {
      config: { projectDir: "/repo", development: { methodology: "tdd" } },
      logger: { warn: vi.fn(), info: vi.fn() },
      emitter: { emit: (_e, data) => events.push(data) },
      eventBase: { sessionId: "s1", iteration: 1, stage: null, startedAt: 0 },
      session: {},
      iteration: 1,
      resolveCmdsImpl: async () => ({ test: "npm test" }),
    },
  };
};

describe("suite-green stage", () => {
  it("a red suite goes back to the coder with the command, the exit code and the tail of the output", async () => {
    const { args, events } = base();
    const r = await runSuiteGreenStage({ ...args, runTestsImpl: async () => ({ exitCode: 1, output: "FAIL tests/x.test.js\nexpected 2 to be 3" }) });
    expect(r).toMatchObject({ action: "continue", result: { ran: true, ok: false, command: "npm test", exitCode: 1 } });
    expect(args.session.last_reviewer_feedback).toMatch(/test suite is RED \(npm test, exit 1\)/);
    expect(args.session.last_reviewer_feedback).toContain("expected 2 to be 3");
    expect(events.find((e) => e.type === "tests:result")).toMatchObject({ status: "fail" });
  });

  it("a green suite lets the iteration go on", async () => {
    const { args, events } = base();
    const r = await runSuiteGreenStage({ ...args, runTestsImpl: async () => ({ exitCode: 0, output: "ok" }) });
    expect(r).toMatchObject({ action: "ok", result: { ran: true, ok: true } });
    expect(args.session.last_reviewer_feedback).toBeUndefined();
    expect(events.find((e) => e.type === "tests:result")).toMatchObject({ status: "ok" });
  });

  it("with no test command it says the suite was not run, and goes on", async () => {
    const { args, events } = base();
    const run = vi.fn();
    const r = await runSuiteGreenStage({ ...args, resolveCmdsImpl: async () => ({}), runTestsImpl: run });
    expect(r).toEqual({ action: "ok", result: { ran: false } });
    expect(run).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "tests:result")).toMatchObject({ status: "warn" });
    expect(args.logger.warn.mock.calls.flat().join(" ")).toMatch(/NOT run/);
  });
});
