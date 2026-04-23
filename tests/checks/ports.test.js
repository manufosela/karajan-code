import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/port-check.js", () => ({
  isPortAvailable: vi.fn(),
  findAvailablePort: vi.fn(),
}));

vi.mock("../../src/utils/port-occupant.js", () => ({
  getPortOccupant: vi.fn(),
}));

describe("checks/ports", () => {
  let mod, portCheck, portOcc;

  beforeEach(async () => {
    vi.resetAllMocks();
    mod = await import("../../src/checks/ports.js");
    portCheck = await import("../../src/utils/port-check.js");
    portOcc = await import("../../src/utils/port-occupant.js");
  });

  describe("sonar port", () => {
    const config = { sonarqube: { enabled: true, host: "http://localhost:9000" } };

    it("OK when free", async () => {
      portCheck.isPortAvailable.mockResolvedValue(true);
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(true);
    });

    it("OK when held by docker/sonar itself", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 123, command: "docker-proxy", raw: "" });
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(true);
      expect(result.detail).toContain("Karajan-managed");
    });

    it("FAIL with occupant details when held by other process", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 999, command: "java", raw: "" });
      const check = mod.createSonarPortCheck();
      const result = await check.detect({ config });
      expect(result.ok).toBe(false);
      expect(result.severity).toBe("fail");
      expect(result.detail).toContain("java");
      expect(result.detail).toContain("999");
      expect(result.extra.port).toBe(9000);
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
