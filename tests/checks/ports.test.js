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

    it("applies only when Sonar is enabled", () => {
      const check = mod.createSonarPortCheck();
      expect(check.applies({ sonarqube: { enabled: false } })).toBe(false);
      expect(check.applies({ sonarqube: { enabled: true } })).toBe(true);
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
