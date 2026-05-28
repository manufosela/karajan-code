// KJC-TSK-0470 — `kj doctor` harness-scorecard check.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/audit/harness-scorecard.js", () => ({
  isDockerAvailable: vi.fn(), isHarnessImagePresent: vi.fn(),
  normalizeHarnessConfig: vi.fn((h = {}) => ({
    enabled: h.enabled !== false, image: h.image || "markmishaev76/ai-harness-scorecard:latest",
  })),
}));
import { isDockerAvailable, isHarnessImagePresent } from "../../src/audit/harness-scorecard.js";
import { getHarnessScorecardChecks } from "../../src/checks/harness-scorecard.js";

describe("checks/harness-scorecard — KJC-TSK-0470", () => {
  beforeEach(() => { isDockerAvailable.mockReset(); isHarnessImagePresent.mockReset(); });

  it("disabled when audit.harness.enabled === false", async () => {
    const [check] = getHarnessScorecardChecks();
    const r = await check.detect({ config: { audit: { harness: { enabled: false } } } });
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/Disabled/);
    expect(isDockerAvailable).not.toHaveBeenCalled();
  });

  it("warn when Docker not available", async () => {
    isDockerAvailable.mockResolvedValue(false);
    const [check] = getHarnessScorecardChecks();
    const r = await check.detect({ config: {} });
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.fix).toMatch(/Docker/);
  });

  it("info when Docker present but image not pulled yet", async () => {
    isDockerAvailable.mockResolvedValue(true);
    isHarnessImagePresent.mockResolvedValue(false);
    const [check] = getHarnessScorecardChecks();
    const r = await check.detect({ config: {} });
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/pulled on first/i);
  });

  it("ok when Docker present and image cached", async () => {
    isDockerAvailable.mockResolvedValue(true);
    isHarnessImagePresent.mockResolvedValue(true);
    const [check] = getHarnessScorecardChecks();
    const r = await check.detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/cached/i);
  });
});
