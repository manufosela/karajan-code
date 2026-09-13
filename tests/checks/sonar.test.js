// KJC-TSK-0838 — `kj doctor` treats Sonar switched off as a DEFECT, not a
// preference: Sonar is mandatory for code (ADR 2026-09-13); the commit gate
// rejects code diffs without a sonar proof, so a disabled config only hurts.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/sonar/manager.js", () => ({ isSonarReachable: vi.fn() }));
import { isSonarReachable } from "../../src/sonar/manager.js";
import { getSonarChecks } from "../../src/checks/sonar.js";

describe("checks/sonar — KJC-TSK-0838", () => {
  beforeEach(() => isSonarReachable.mockReset());

  it("sonarqube.enabled: false is a failing check that names the rule and the fix", async () => {
    const [check] = getSonarChecks();
    const r = await check.detect({ config: { sonarqube: { enabled: false } } });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("fail");
    expect(r.detail).toMatch(/mandatory for code/);
    expect(r.fix).toMatch(/sonarqube\.enabled: true/);
    expect(isSonarReachable).not.toHaveBeenCalled();
  });

  it("review_gate.sonar: false fails the same way", async () => {
    const [check] = getSonarChecks();
    const r = await check.detect({ config: { review_gate: { sonar: false } } });
    expect(r.ok).toBe(false);
    expect(r.fix).toMatch(/review_gate\.sonar/);
  });

  it("enabled and reachable is ok", async () => {
    isSonarReachable.mockResolvedValue(true);
    const [check] = getSonarChecks();
    const r = await check.detect({ config: { sonarqube: { enabled: true } } });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/Reachable/);
  });
});
