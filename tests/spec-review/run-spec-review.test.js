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

  // KJC-TSK-0674 (issue #1289): unattended runs must never silently
  // continue past FAIL findings — only warn/info declare the safe default
  // that --yes / KJ_NON_INTERACTIVE auto-answer.
  it("declares defaultAnswer 'continue' for warn but NOT for fail", async () => {
    for (const [findings, expected] of [[findingsWarn, "continue"], [findingsFail, undefined]]) {
      const ask = vi.fn().mockResolvedValue("continue");
      const { runSpecReview } = await loadWith({ ok: true, result: { severity: findings[0].severity, findings } });
      await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: ask, flags: { forceSpecReview: true } });
      expect(ask.mock.calls[0][1].defaultAnswer).toBe(expected);
    }
  });

  it("empty answer (Enter) cancels at severity fail instead of continuing", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: findingsFail } });
    const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: vi.fn().mockResolvedValue(""), flags: { forceSpecReview: true } });
    expect(r).toMatchObject({ proceed: false, cancelled: true });
  });

  it("treats empty / 'c' / 'continue' / unknown as continue", async () => {
    for (const answer of ["", "c", "continue", "yes"]) {
      const { runSpecReview } = await loadWith({ ok: true, result: { severity: "warn", findings: findingsWarn } });
      const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: vi.fn().mockResolvedValue(answer), flags: { forceSpecReview: true } });
      expect(r.proceed).toBe(true);
      expect(r.cancelled).toBeUndefined();
    }
  });

  it("autonomous: the resolver decides, never asks the human, never cancels (gap G1)", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: findingsFail } });
    const resolve = vi.fn().mockResolvedValue({ choice: "PROCEED", source: "arbiter" });
    const askQuestion = vi.fn();
    const r = await runSpecReview({
      spec: "x", config: {}, logger: noopLog, askQuestion, resolve, autonomy: "autonomous",
      flags: { forceSpecReview: true },
    });
    expect(r).toMatchObject({ proceed: true });
    expect(r.cancelled).toBeUndefined();
    expect(askQuestion).not.toHaveBeenCalled(); // no human in the loop
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("never blocks when the reviewer itself failed (proceed=true + warn log)", async () => {
    const { runSpecReview } = await loadWith({ ok: false, summary: "agent crashed", result: { error: "boom" } });
    const r = await runSpecReview({ spec: "x", config: {}, logger: noopLog, flags: { forceSpecReview: true } });
    expect(r.proceed).toBe(true);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

// KJC-BUG-0125 (issue #1275): the prompt carries the FULL findings so the
// dashboard modal can show what is wrong and how to fix it — not just a count.
describe("prompt payload carries full findings", () => {
  const rich = [
    { id: "F-001", severity: "fail", category: "missing_ac", message: "no acceptance criteria", suggestion: "add Given/When/Then" },
    { id: "F-002", severity: "warn", category: "ambiguity", message: "vague scope", suggestion: null },
  ];

  it("interactive askQuestion detail includes findings with message + suggestion", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: rich } });
    const askQuestion = vi.fn().mockResolvedValue("continue");
    await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion, flags: { forceSpecReview: true } });
    const detail = askQuestion.mock.calls[0][1].detail;
    expect(detail.findings).toHaveLength(2);
    expect(detail.findings[0]).toMatchObject({ id: "F-001", severity: "fail", message: "no acceptance criteria", suggestion: "add Given/When/Then" });
    expect(detail.findings[1].suggestion).toBeNull();
  });

  it("caps the findings shipped in the prompt", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `F-${i}`, severity: "warn", category: "c", message: "m" }));
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "warn", findings: many } });
    const askQuestion = vi.fn().mockResolvedValue("continue");
    await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion, flags: { forceSpecReview: true } });
    expect(askQuestion.mock.calls[0][1].detail.findings).toHaveLength(20);
    expect(askQuestion.mock.calls[0][1].detail.findingCount).toBe(30); // the real total stays visible
  });

  it("autonomous resolver context includes findings too", async () => {
    const { runSpecReview } = await loadWith({ ok: true, result: { severity: "fail", findings: rich } });
    const resolve = vi.fn().mockResolvedValue({ choice: "PROCEED" });
    await runSpecReview({ spec: "x", config: {}, logger: noopLog, askQuestion: vi.fn(), resolve, autonomy: "autonomous", flags: { forceSpecReview: true } });
    expect(resolve.mock.calls[0][0].context.findings).toHaveLength(2);
  });
});
