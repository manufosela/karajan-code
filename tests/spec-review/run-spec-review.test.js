// Tests for the pre-pipeline spec-review orchestrator (KJC-PCS-0048 PR 2).

import { describe, expect, it, vi, beforeEach } from "vitest";

const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

beforeEach(() => { for (const fn of Object.values(noopLog)) fn.mockClear?.(); });

async function loadWith(roleMock) {
  vi.resetModules();
  vi.doMock("../../src/roles/spec-reviewer-role.js", () => ({
    SpecReviewerRole: class {
      async init() {} async execute() { return roleMock; }
    },
  }));
  return import("../../src/spec-review/run-spec-review.js");
}

describe("runSpecReview", () => {
  const findingsWarn = [{ id: "F-001", severity: "warn", category: "ambiguity", message: "vague" }];
  const findingsFail = [{ id: "F-001", severity: "fail", category: "missing_ac", message: "no AC" }];

  it("skips on flag / config-disabled / empty-spec", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: findingsFail } });
    expect((await runSpecReview({ spec: "x", config: {}, logger: noopLog, flags: { forceSpecReview: true, skipSpecReview: true } })).skipped).toBe(true);
    expect((await runSpecReview({ spec: "x", config: { spec_reviewer: { enabled: false } }, logger: noopLog, flags: { forceSpecReview: true } })).skipped).toBe(true);
    expect((await runSpecReview({ spec: "  ", config: {}, logger: noopLog, flags: { forceSpecReview: true } })).skipped).toBe(true);
  });

  it("proceeds silently with `✓ spec OK` when severity=ok / no findings", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "ok", findings: [] } });
    const r = await runSpecReview({ spec: "good", config: {}, logger: noopLog, flags: { forceSpecReview: true } });
    expect(r.proceed).toBe(true);
    expect(noopLog.info).toHaveBeenCalledWith("✓ spec OK");
  });

  it("continues without asking when no TTY (askQuestion is null)", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "warn", findings: findingsWarn } });
    const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: null, flags: { forceSpecReview: true } });
    expect(r).toMatchObject({ proceed: true, severity: "warn" });
  });

  it("cancels on answer starting with x / 'cancel' / null (=stop)", async () => {
    for (const answer of ["x", "X", "cancel", null]) {
      const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: findingsFail } });
      const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: vi.fn().mockResolvedValue(answer), flags: { forceSpecReview: true } });
      expect(r.proceed).toBe(false);
      expect(r.cancelled).toBe(true);
    }
  });

  it("treats empty / 'c' / 'continue' / unknown as continue", async () => {
    for (const answer of ["", "c", "continue", "yes"]) {
      const { runSpecReview } = await loadWith({ ok: true, result: { severity: "warn", findings: findingsWarn } });
      const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: vi.fn().mockResolvedValue(answer), flags: { forceSpecReview: true } });
      expect(r.proceed).toBe(true);
      expect(r.cancelled).toBeUndefined();
    }
  });

  it("never blocks when the reviewer itself failed (proceed=true + warn log)", async () => {
    const { runSpecReview } = await loadWith({ ok: false, summary: "agent crashed", result: { error: "boom" } });
    const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, flags: { forceSpecReview: true } });
    expect(r.proceed).toBe(true);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});
