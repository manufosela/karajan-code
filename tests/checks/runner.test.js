import { describe, expect, it, vi } from "vitest";
import { runChecks, toLegacyShape } from "../../src/checks/runner.js";
import { STATUS, STRATEGY } from "../../src/checks/types.js";

function makeCheck(overrides = {}) {
  return {
    name: "test-check",
    label: "Test",
    strategy: STRATEGY.AUTO,
    detect: vi.fn(async () => ({ ok: true, severity: "info", detail: "OK" })),
    ...overrides,
  };
}

describe("checks/runner", () => {
  describe("detect phase", () => {
    it("runs detect in parallel and returns OK status for passing checks", async () => {
      const c1 = makeCheck({ name: "a" });
      const c2 = makeCheck({ name: "b" });
      const report = await runChecks([c1, c2], { config: {} });
      expect(report.checks).toHaveLength(2);
      expect(report.summary.ok).toBe(2);
      expect(c1.detect).toHaveBeenCalledOnce();
      expect(c2.detect).toHaveBeenCalledOnce();
    });

    it("marks checks as SKIPPED when applies returns false", async () => {
      const c = makeCheck({ applies: () => false });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.SKIPPED);
      expect(report.checks[0].detail).toBe("Not applicable for current configuration");
      expect(c.detect).not.toHaveBeenCalled();
    });

    it("uses the reason from applies() when given { applies: false, reason }", async () => {
      // Per-check skip reason — lets users see WHY a check was skipped
      // (e.g. "sonarqube.enabled is false in kj.config.yml") instead of
      // the opaque default "Not applicable" message.
      const c = makeCheck({
        applies: () => ({ applies: false, reason: "sonarqube.enabled is false in kj.config.yml" }),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.SKIPPED);
      expect(report.checks[0].detail).toBe("sonarqube.enabled is false in kj.config.yml");
      expect(c.detect).not.toHaveBeenCalled();
    });

    it("treats { applies: true } object identically to boolean true", async () => {
      const c = makeCheck({ applies: () => ({ applies: true }) });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.OK);
      expect(c.detect).toHaveBeenCalledOnce();
    });

    it("catches thrown errors in detect and marks as FAIL", async () => {
      const c = makeCheck({
        detect: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].detail).toContain("boom");
    });

    it("marks slow detects as TIMEOUT", async () => {
      const c = makeCheck({
        detect: () => new Promise(() => {}),
      });
      const report = await runChecks([c], { config: {} }, { timeoutMs: 25 });
      expect(report.checks[0].status).toBe(STATUS.TIMEOUT);
    });

    it("WARN + AUTO still remediates (non-invasive fixes apply even for soft failures)", async () => {
      const c = makeCheck({
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "warn", detail: "soft" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "fixed" })),
      });
      c.detect.mockImplementationOnce(async () => ({ ok: false, severity: "warn", detail: "soft" }))
        .mockImplementation(async () => ({ ok: true, severity: "info", detail: "ok" }));
      const report = await runChecks([c], { config: {} });
      expect(c.remediate).toHaveBeenCalled();
      expect(report.checks[0].status).toBe(STATUS.FIXED);
    });
  });

  describe("degradable checks (KJC-BUG-0049)", () => {
    it("degrades FAIL → WARN and disables feature flag when check is degradable", async () => {
      const c = makeCheck({
        strategy: STRATEGY.MANUAL,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "no token" })),
        degradable: {
          disables: ["git.auto_pr"],
          warn: "auto_pr disabled",
        },
      });
      const report = await runChecks([c], { config: { git: { auto_pr: true } } });
      expect(report.checks[0].status).toBe(STATUS.WARN);
      expect(report.checks[0].detail).toContain("auto_pr disabled");
      expect(report.overrides.git.auto_pr).toBe(false);
      expect(report.summary.fail).toBe(0);
      expect(report.summary.warn).toBe(1);
    });

    it("supports multiple disables in one degradable check", async () => {
      const c = makeCheck({
        strategy: STRATEGY.MANUAL,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "missing" })),
        degradable: {
          disables: ["git.auto_pr", "git.auto_push", "ci.enabled"],
          warn: "git/ci automation off",
        },
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.WARN);
      expect(report.overrides.git.auto_pr).toBe(false);
      expect(report.overrides.git.auto_push).toBe(false);
      expect(report.overrides.ci.enabled).toBe(false);
    });

    it("does NOT touch overrides when check is degradable but passes", async () => {
      const c = makeCheck({
        detect: vi.fn(async () => ({ ok: true, severity: "info", detail: "OK" })),
        degradable: { disables: ["git.auto_pr"], warn: "should not show" },
      });
      const report = await runChecks([c], { config: { git: { auto_pr: true } } });
      expect(report.checks[0].status).toBe(STATUS.OK);
      expect(report.overrides.git?.auto_pr).toBeUndefined();
    });

    it("does NOT degrade when check is NOT degradable (regression)", async () => {
      const c = makeCheck({
        strategy: STRATEGY.MANUAL,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "missing" })),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.summary.fail).toBe(1);
    });
  });

  describe("remediate phase", () => {
    it("FIXED when remediate succeeds and re-verify passes", async () => {
      let detectCall = 0;
      const c = makeCheck({
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => {
          detectCall++;
          return detectCall === 1
            ? { ok: false, severity: "fail", detail: "busy" }
            : { ok: true, severity: "info", detail: "ok" };
        }),
        remediate: vi.fn(async () => ({ fixed: true, detail: "remedied" })),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.FIXED);
      expect(c.remediate).toHaveBeenCalledOnce();
      expect(c.detect).toHaveBeenCalledTimes(2); // detect + re-verify
    });

    it("FAIL when remediate returns fixed:false", async () => {
      const c = makeCheck({
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "busy" })),
        remediate: vi.fn(async () => ({ fixed: false, detail: "could not" })),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].detail).toBe("could not");
    });

    it("FAIL when remediation succeeds but re-verify still fails", async () => {
      const c = makeCheck({
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "busy" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "did something" })),
      });
      const report = await runChecks([c], { config: {} });
      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].detail).toContain("re-verify failed");
    });

    it("does not remediate manual-strategy checks", async () => {
      const c = makeCheck({
        strategy: STRATEGY.MANUAL,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "missing" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "nope" })),
      });
      const report = await runChecks([c], { config: {} });
      expect(c.remediate).not.toHaveBeenCalled();
      expect(report.checks[0].status).toBe(STATUS.FAIL);
    });

    it("merges remediation `changes` into runReport.overrides (deep-merge)", async () => {
      const c1 = makeCheck({
        name: "c1",
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "busy" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "done", changes: { hu_board: { port: 4007 } } })),
      });
      const c2 = makeCheck({
        name: "c2",
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "busy" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "done", changes: { hu_board: { host: "0.0.0.0" } } })),
      });
      // Make both re-verifies pass
      c1.detect.mockImplementationOnce(async () => ({ ok: false, severity: "fail", detail: "busy" }))
        .mockImplementation(async () => ({ ok: true, severity: "info", detail: "ok" }));
      c2.detect.mockImplementationOnce(async () => ({ ok: false, severity: "fail", detail: "busy" }))
        .mockImplementation(async () => ({ ok: true, severity: "info", detail: "ok" }));
      const report = await runChecks([c1, c2], { config: {} });
      expect(report.overrides.hu_board).toEqual({ port: 4007, host: "0.0.0.0" });
    });

    it("respects check-only mode (no remediation attempted)", async () => {
      const c = makeCheck({
        strategy: STRATEGY.AUTO,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "busy" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "would fix" })),
      });
      const report = await runChecks([c], { config: {} }, { mode: "check-only" });
      expect(c.remediate).not.toHaveBeenCalled();
      expect(report.checks[0].status).toBe(STATUS.FAIL);
    });

    it("WARN + PROMPT does not nag the user (soft failures don't prompt)", async () => {
      const c = makeCheck({
        strategy: STRATEGY.PROMPT,
        describe: "Install X",
        detect: vi.fn(async () => ({ ok: false, severity: "warn", detail: "missing" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "installed" })),
      });
      const onConfirm = vi.fn(async () => false);
      const report = await runChecks([c], { config: {} }, { onConfirm });
      expect(c.remediate).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(report.checks[0].status).toBe(STATUS.WARN);
    });

    it("FAIL + PROMPT declined by user stays FAIL (remediate not called)", async () => {
      const c = makeCheck({
        strategy: STRATEGY.PROMPT,
        describe: "Install X",
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "missing" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "installed" })),
      });
      const onConfirm = vi.fn(async () => false);
      const report = await runChecks([c], { config: {} }, { onConfirm });
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(c.remediate).not.toHaveBeenCalled();
      expect(report.checks[0].status).toBe(STATUS.FAIL);
    });

    it("PROMPT-strategy FAIL check auto-confirmed by yes:true calls remediate", async () => {
      const c = makeCheck({
        strategy: STRATEGY.PROMPT,
        detect: vi.fn(async () => ({ ok: false, severity: "fail", detail: "missing" })),
        remediate: vi.fn(async () => ({ fixed: true, detail: "installed" })),
      });
      c.detect.mockImplementationOnce(async () => ({ ok: false, severity: "fail", detail: "missing" }))
        .mockImplementation(async () => ({ ok: true, severity: "info", detail: "ok" }));
      const report = await runChecks([c], { config: {} }, { yes: true });
      expect(c.remediate).toHaveBeenCalledOnce();
      expect(report.checks[0].status).toBe(STATUS.FIXED);
    });
  });

  describe("toLegacyShape", () => {
    it("maps FIXED/OK/SKIPPED to ok:true", async () => {
      const report = { checks: [
        { name: "a", label: "A", status: STATUS.OK, detail: "" },
        { name: "b", label: "B", status: STATUS.FIXED, detail: "" },
        { name: "c", label: "C", status: STATUS.SKIPPED, detail: "" },
      ] };
      const legacy = toLegacyShape(report);
      expect(legacy.every((c) => c.ok)).toBe(true);
    });

    it("maps FAIL/WARN/TIMEOUT to ok:false", async () => {
      const report = { checks: [
        { name: "a", label: "A", status: STATUS.FAIL, detail: "" },
        { name: "b", label: "B", status: STATUS.WARN, detail: "" },
        { name: "c", label: "C", status: STATUS.TIMEOUT, detail: "" },
      ] };
      const legacy = toLegacyShape(report);
      expect(legacy.every((c) => !c.ok)).toBe(true);
    });
  });
});
