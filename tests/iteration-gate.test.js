import { describe, expect, it, vi } from "vitest";

import { buildIterationReport, appendUserDirective, handleIterationGate } from "../src/orchestrator/iteration-gate.js";

vi.mock("../src/session/store.js", () => ({ markSessionStatus: vi.fn() }));

const tracker = (usd) => ({ total: () => ({ cost_usd: usd }) });

describe("iteration-gate (KJC-TSK-0628)", () => {
  it("the report says what happened, what comes next, and the spend vs cap", () => {
    const report = buildIterationReport({
      i: 2,
      maxIterations: 5,
      stageResults: { coder: {}, reviewer: { approved: false, must_fix: ["fix null check", "add test", "rename var", "split fn"] } },
      budgetTracker: tracker(1.37),
      maxBudgetUsd: 5,
    });
    expect(report).toContain("Iteration 2/5");
    expect(report).toContain("4 must-fix");
    expect(report).toContain("fix null check");
    expect(report).toContain("… and 1 more");
    expect(report).toContain("the coder tackles those 4 must-fix");
    expect(report).toContain("Spend: $1.37 / cap $5.00");
  });

  it("disabled gate or nobody-to-ask passes straight through", async () => {
    expect(await handleIterationGate({ enabled: false, askQuestion: vi.fn() })).toEqual({ action: "continue" });
    expect(await handleIterationGate({ enabled: true, askQuestion: null })).toEqual({ action: "continue" });
    const unattended = vi.fn();
    unattended.unattended = true;
    expect(await handleIterationGate({ enabled: true, askQuestion: unattended })).toEqual({ action: "continue" });
    expect(unattended).not.toHaveBeenCalled();
  });

  it("empty answer continues, stop stops and marks the session", async () => {
    const { markSessionStatus } = await import("../src/session/store.js");
    const session = {};
    expect(
      await handleIterationGate({ enabled: true, askQuestion: async () => "", session, report: "r" }),
    ).toEqual({ action: "continue" });
    expect(
      await handleIterationGate({ enabled: true, askQuestion: async () => "stop", session, report: "r" }),
    ).toEqual({ action: "stop" });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "stopped");
  });

  it("free text becomes a directive appended to the reviewer feedback, never clobbering it", async () => {
    const session = { last_reviewer_feedback: "must-fix: arregla el parser" };
    const result = await handleIterationGate({
      enabled: true,
      askQuestion: async () => "prioriza el fichero de config y no toques la API pública",
      session,
      report: "r",
      logger: { info: vi.fn() },
    });
    expect(result).toEqual({ action: "continue", injected: "prioriza el fichero de config y no toques la API pública" });
    expect(session.last_reviewer_feedback).toContain("must-fix: arregla el parser");
    expect(session.last_reviewer_feedback).toContain("## User directive (iteration gate)");
    expect(session.last_reviewer_feedback).toContain("prioriza el fichero de config");
  });

  it("appendUserDirective on an empty session starts the block cleanly", () => {
    const session = {};
    appendUserDirective(session, "usa el patrón del módulo vecino");
    expect(session.last_reviewer_feedback).toBe("## User directive (iteration gate)\nusa el patrón del módulo vecino");
  });
});
