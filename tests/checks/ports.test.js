import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/port-check.js", () => ({
  isPortAvailable: vi.fn(),
  findAvailablePort: vi.fn(),
}));

vi.mock("../../src/utils/port-occupant.js", () => ({
  getPortOccupant: vi.fn(),
}));

vi.mock("../../src/sonar/discovery.js", () => ({
  discoverRunningSonar: vi.fn(),
}));

vi.mock("../../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn(),
}));

describe("checks/ports", () => {
  let mod, portCheck, portOcc, sonarDiscovery, sonarManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    mod = await import("../../src/checks/ports.js");
    portCheck = await import("../../src/utils/port-check.js");
    portOcc = await import("../../src/utils/port-occupant.js");
    sonarDiscovery = await import("../../src/sonar/discovery.js");
    sonarManager = await import("../../src/sonar/manager.js");
    // Default: discovery finds nothing — tests that need a hit override.
    sonarDiscovery.discoverRunningSonar.mockResolvedValue({ found: false });
    sonarManager.isSonarReachable.mockResolvedValue(false);
  });

  describe("sonar port", () => {
    const config = { sonarqube: { enabled: true, host: "http://localhost:9000" } };

    it("OK when free", async () => {
      portCheck.isPortAvailable.mockResolvedValue(true);
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(true);
    });

    it("OK when a Sonar container is already running on the configured port", async () => {
      sonarDiscovery.discoverRunningSonar.mockResolvedValue({
        found: true, reachable: true, containerName: "karajan-sonarqube",
        port: 9000, host: "http://localhost:9000",
      });
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(true);
      expect(result.detail).toMatch(/Reusing running SonarQube/);
    });

    it("auto-rebinds to a discovered Sonar running on a different port", async () => {
      sonarDiscovery.discoverRunningSonar.mockResolvedValue({
        found: true, reachable: true, containerName: "some-other-sonar",
        port: 9015, host: "http://localhost:9015",
      });
      const check = mod.createSonarPortCheck();
      const detect = await check.detect({ config });
      expect(detect.ok).toBe(false);
      expect(detect.severity).toBe("warn");
      expect(detect.extra.remap.host).toBe("http://localhost:9015");

      const rem = await check.remediate({ extra: detect.extra });
      expect(rem.fixed).toBe(true);
      expect(rem.changes.sonarqube.host).toBe("http://localhost:9015");
    });

    it("OK when port is occupied by a Sonar that responds to /api/system/status (HTTP fallback)", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      sonarManager.isSonarReachable.mockResolvedValue(true);
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(true);
      expect(result.detail).toMatch(/HTTP/);
    });

    it("WARN + auto-rebind when port held by an unrelated process", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 999, command: "java", raw: "" });
      portCheck.findAvailablePort.mockResolvedValue(9001);
      const check = mod.createSonarPortCheck();
      const detect = await check.detect({ config });
      expect(detect.ok).toBe(false);
      expect(detect.severity).toBe("warn");
      expect(detect.detail).toContain("java");
      expect(detect.extra.remap.port).toBe(9001);

      const rem = await check.remediate({ extra: detect.extra });
      expect(rem.fixed).toBe(true);
      expect(rem.changes.sonarqube.host).toBe("http://localhost:9001");
    });

    it("FAILS only when nothing else is free in the next 20 ports", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 999, command: "java", raw: "" });
      portCheck.findAvailablePort.mockResolvedValue(null);
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe("fail");
    });

    it("applies for any non-external config (Sonar is intrinsic since v2.7.4)", () => {
      const check = mod.createSonarPortCheck();
      // Post-v2.7.4: `sonarqube.enabled` is ignored — Sonar is intrinsic
      // to Karajan for code tasks. The only legitimate skip is when the
      // user runs their own external Sonar instance.
      expect(check.applies({})).toBe(true);
      expect(check.applies({ sonarqube: {} })).toBe(true);
      expect(check.applies({ sonarqube: { enabled: false } })).toBe(true); // ignored!
      expect(check.applies({ sonarqube: { enabled: true } })).toBe(true);

      const external = check.applies({ sonarqube: { external: true } });
      expect(external).toEqual({ applies: false, reason: expect.stringMatching(/external/i) });
    });
  });

  describe("hu-board port", () => {
    it("OK when free", async () => {
      portCheck.isPortAvailable.mockResolvedValue(true);
      const check = mod.createHuBoardPortCheck();
      const result = await check.detect({ config: {} });
      expect(result.ok).toBe(true);
    });

    it("WARN when busy, and remediate finds next free port", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 4000, pid: 456, command: "node", raw: "" });
      portCheck.findAvailablePort.mockResolvedValue(4007);
      const check = mod.createHuBoardPortCheck();
      const detect = await check.detect({ config: {} });
      expect(detect.ok).toBe(false);
      expect(detect.severity).toBe("warn");
      const rem = await check.remediate({ extra: detect.extra });
      expect(rem.fixed).toBe(true);
      expect(rem.changes.hu_board.port).toBe(4007);
      expect(portCheck.findAvailablePort).toHaveBeenCalledWith(4001, 20);
    });
  });
});
