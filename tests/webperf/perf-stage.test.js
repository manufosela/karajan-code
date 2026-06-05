import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

const noopLogger = createNoopLoggerWithContext();
const emitter = { emit: vi.fn() };

let tmpHome, tmpProject, originalHome;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kj-perf-stage-"));
  tmpProject = path.join(tmpHome, "my-app");
  await fs.mkdir(tmpProject, { recursive: true });
  await fs.mkdir(path.join(tmpProject, ".karajan", "sessions", "s_test"), { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  vi.resetModules();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeSession() {
  return {
    session_id: "s_test",
    sessionDir: path.join(tmpProject, ".karajan", "sessions", "s_test"),
    journal: { iterations: [] },
    feedback: {},
  };
}

function makeArgs(overrides = {}) {
  return {
    config: {
      projectDir: tmpProject,
      webperf: { url: "http://localhost:3000" },
    },
    logger: noopLogger,
    emitter,
    eventBase: { session_id: "s_test" },
    session: makeSession(),
    trackBudget: vi.fn(),
    iteration: 1,
    task: "test task",
    brainCtx: null,
    ...overrides,
  };
}

describe("runPerfStage (KJC-TSK-0151)", () => {
  it("returns ok with PASS verdict and stage result when CWV pass", async () => {
    vi.doMock("../../src/roles/perf-role.js", () => ({
      PerfRole: class {
        async execute() {
          return {
            ok: true,
            summary: "Webperf PASS (score 92/100, lcp=good, cls=good, inp=good)",
            result: {
              url: "http://localhost:3000",
              performanceScore: 92,
              cwv: { pass: true, blocking: [] },
              savedPath: "/tmp/last.json",
            },
          };
        }
      },
    }));

    const { runPerfStage } = await import("../../src/orchestrator/stages/perf-stage.js");
    const r = await runPerfStage(makeArgs());

    expect(r.action).toBe("ok");
    expect(r.stageResult.verdict).toBe("PASS");
    expect(r.stageResult.performanceScore).toBe(92);
    expect(r.stageResult.url).toBe("http://localhost:3000");
  });

  it("returns continue with FAIL verdict and writes reviewer feedback on FAIL", async () => {
    vi.doMock("../../src/roles/perf-role.js", () => ({
      PerfRole: class {
        async execute() {
          return {
            ok: false,
            summary: "Webperf FAIL (score 35/100): LCP=5500 (poor>4000)",
            result: {
              url: "http://localhost:3000",
              performanceScore: 35,
              cwv: { pass: false, blocking: [{ metric: "lcp", value: 5500, threshold: 4000, rating: "poor" }] },
              issues: [{ id: "render-blocking-resources", savingsMs: 800 }],
            },
          };
        }
      },
    }));
    const setReviewerFeedback = vi.fn();
    const saveSession = vi.fn();
    vi.doMock("../../src/session/mutators.js", () => ({ setReviewerFeedback }));
    vi.doMock("../../src/session/store.js", () => ({ saveSession }));

    const { runPerfStage } = await import("../../src/orchestrator/stages/perf-stage.js");
    const r = await runPerfStage(makeArgs());

    expect(r.action).toBe("continue");
    expect(r.stageResult.verdict).toBe("FAIL");
    expect(setReviewerFeedback).toHaveBeenCalledTimes(1);
    const [, feedback] = setReviewerFeedback.mock.calls[0];
    expect(feedback).toContain("Webperf gate FAILED");
    expect(feedback).toContain("LCP=5500");
    expect(feedback).toContain("render-blocking-resources");
    expect(saveSession).toHaveBeenCalledTimes(1);
  });

  it("returns ok-skipped when scanner is unavailable (lighthouse missing)", async () => {
    vi.doMock("../../src/roles/perf-role.js", () => ({
      PerfRole: class {
        async execute() {
          return {
            ok: false,
            summary: "Webperf scan failed: lighthouse not installed",
            result: { error: "lighthouse not installed" },
          };
        }
      },
    }));

    const { runPerfStage } = await import("../../src/orchestrator/stages/perf-stage.js");
    const r = await runPerfStage(makeArgs());

    expect(r.action).toBe("ok");
    expect(r.stageResult.skipped).toBe(true);
    expect(r.stageResult.reason).toContain("not installed");
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it("invokes brain.processRoleOutput when brainCtx.enabled and verdict is FAIL", async () => {
    vi.doMock("../../src/roles/perf-role.js", () => ({
      PerfRole: class {
        async execute() {
          return {
            ok: false,
            summary: "Webperf FAIL",
            result: {
              url: "http://localhost:3000",
              performanceScore: 30,
              cwv: { pass: false, blocking: [{ metric: "lcp", value: 6000, threshold: 4000, rating: "poor" }] },
              issues: [],
            },
          };
        }
      },
    }));
    vi.doMock("../../src/session/mutators.js", () => ({ setReviewerFeedback: vi.fn() }));
    vi.doMock("../../src/session/store.js", () => ({ saveSession: vi.fn() }));
    const processRoleOutput = vi.fn();
    vi.doMock("../../src/orchestrator/brain-coordinator.js", () => ({ processRoleOutput }));

    const { runPerfStage } = await import("../../src/orchestrator/stages/perf-stage.js");
    const r = await runPerfStage(makeArgs({ brainCtx: { enabled: true } }));

    expect(r.action).toBe("continue");
    expect(processRoleOutput).toHaveBeenCalledTimes(1);
    const callArg = processRoleOutput.mock.calls[0][1];
    expect(callArg.roleName).toBe("perf");
    expect(callArg.output.verdict).toBe("fail");
  });

  it("throws when session is missing", async () => {
    vi.doMock("../../src/roles/perf-role.js", () => ({
      PerfRole: class {
        async execute() { return { ok: true, summary: "ok", result: {} }; }
      },
    }));

    const { runPerfStage } = await import("../../src/orchestrator/stages/perf-stage.js");
    await expect(runPerfStage(makeArgs({ session: null }))).rejects.toThrow(/session/);
  });
});
