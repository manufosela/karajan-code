// Tests for the Sonar 401 auto-recovery (KJC-BUG-0057 / v2.19.2).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/sonar/token-bootstrap.js", () => ({
  bootstrapSonarToken: vi.fn(),
}));

vi.mock("../../src/sonar/credentials.js", () => ({
  saveSonarToken: vi.fn().mockResolvedValue(undefined),
}));

const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(async () => {
  vi.resetAllMocks();
  const { __resetSonarRecoveryLatchForTests } = await import("../../src/sonar/token-recovery.js");
  __resetSonarRecoveryLatchForTests();
});

describe("recoverSonarToken (KJC-BUG-0057)", () => {
  it("calls bootstrapSonarToken with the configured host", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: true, token: "squ_new", savedTo: "/x/sonar.token" });
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");
    const config = { sonarqube: { host: "http://localhost:9001", token: "stale" } };

    const r = await recoverSonarToken(config, noopLog);

    expect(r.ok).toBe(true);
    expect(r.newToken).toBe("squ_new");
    expect(bootstrapSonarToken).toHaveBeenCalledWith({ host: "http://localhost:9001" });
  });

  it("mutates config.sonarqube.token in place so the immediate retry sees the new token", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: true, token: "squ_new", savedTo: "/x/sonar.token" });
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");
    const config = { sonarqube: { host: "http://localhost:9000", token: "stale" } };

    await recoverSonarToken(config, noopLog);

    expect(config.sonarqube.token).toBe("squ_new");
  });

  it("persists the new token to sonar-credentials.json (best-effort)", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: true, token: "squ_new", savedTo: "/x/sonar.token" });
    const { saveSonarToken } = await import("../../src/sonar/credentials.js");
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");

    await recoverSonarToken({ sonarqube: { host: "http://localhost:9000" } }, noopLog);

    expect(saveSonarToken).toHaveBeenCalledWith("squ_new");
  });

  it("returns ok=false with the upstream reason when bootstrap fails", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: false, reason: "admin/admin login failed" });
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");

    const r = await recoverSonarToken({ sonarqube: { host: "http://localhost:9000" } }, noopLog);

    expect(r.ok).toBe(false);
    expect(r.reason).toContain("admin/admin");
  });

  it("only attempts recovery once per process even when called twice (latch)", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: true, token: "squ_new", savedTo: "/x" });
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");
    const config = { sonarqube: { host: "http://localhost:9000" } };

    await recoverSonarToken(config, noopLog);
    const second = await recoverSonarToken(config, noopLog);

    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already attempted/i);
    expect(bootstrapSonarToken).toHaveBeenCalledOnce();
  });

  it("falls back to default host when config.sonarqube is missing", async () => {
    const { bootstrapSonarToken } = await import("../../src/sonar/token-bootstrap.js");
    bootstrapSonarToken.mockResolvedValue({ ok: true, token: "squ_new", savedTo: "/x" });
    const { recoverSonarToken } = await import("../../src/sonar/token-recovery.js");

    await recoverSonarToken({}, noopLog);

    expect(bootstrapSonarToken).toHaveBeenCalledWith({ host: "http://localhost:9000" });
  });
});
