import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { STATUS } from "../../src/checks/types.js";

/**
 * End-to-end coverage of the auto-remediation flow: each realistic scenario
 * listed in the implementation plan of KJC-TSK-0319 gets an assertion so we
 * catch regressions in the detect → remediate → re-verify pipeline.
 */

vi.mock("../../src/utils/port-check.js", () => ({
  isPortAvailable: vi.fn(),
  findAvailablePort: vi.fn(),
}));
vi.mock("../../src/utils/port-occupant.js", () => ({
  getPortOccupant: vi.fn(),
}));
vi.mock("../../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  },
}));
vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events");
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.stdin = { write: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      setImmediate(() => child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n')));
      return child;
    }),
  };
});

describe("auto-remediation end-to-end", () => {
  let runChecks, portCheck, portOcc, fsPromises;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runChecks } = await import("../../src/checks/runner.js"));
    portCheck = await import("../../src/utils/port-check.js");
    portOcc = await import("../../src/utils/port-occupant.js");
    fsPromises = (await import("node:fs/promises")).default;
  });

  describe("HU Board port rebind", () => {
    it("port 4000 occupied → auto-fixes by finding next free port and applying override", async () => {
      portCheck.isPortAvailable.mockImplementation(async (port) => port !== 4000);
      portOcc.getPortOccupant.mockResolvedValue({ port: 4000, pid: 99, command: "node", raw: "" });
      portCheck.findAvailablePort.mockResolvedValue(4007);

      const { createHuBoardPortCheck } = await import("../../src/checks/ports.js");
      const report = await runChecks([createHuBoardPortCheck()], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FIXED);
      expect(report.overrides).toEqual({ hu_board: { port: 4007 } });
    });
  });

  describe("~/.karajan directory tree", () => {
    it("missing dirs → auto-created and re-verify succeeds", async () => {
      // First call (detect): dirs missing. Second call (re-verify): dirs exist.
      let detectCall = 0;
      fsPromises.stat.mockImplementation(async () => {
        detectCall++;
        if (detectCall <= 4) {
          const err = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        return { isDirectory: () => true };
      });
      fsPromises.mkdir.mockResolvedValue(undefined);

      const { createKarajanDirsCheck } = await import("../../src/checks/dir-setup.js");
      const report = await runChecks([createKarajanDirsCheck()], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FIXED);
      expect(fsPromises.mkdir).toHaveBeenCalled();
    });

    it("remediation runs but re-verify still sees missing dirs → FAIL", async () => {
      // Always missing, even after remediate (e.g. permission denied, silent fail).
      fsPromises.stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      fsPromises.mkdir.mockResolvedValue(undefined);

      const { createKarajanDirsCheck } = await import("../../src/checks/dir-setup.js");
      const report = await runChecks([createKarajanDirsCheck()], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].detail).toContain("re-verify failed");
    });
  });

  describe("SonarQube port (manual)", () => {
    it("port 9000 held by Karajan docker → OK without remediation", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 1, command: "docker-proxy", raw: "" });

      const { createSonarPortCheck } = await import("../../src/checks/ports.js");
      const report = await runChecks([createSonarPortCheck()], {
        config: { sonarqube: { enabled: true, host: "http://localhost:9000" } },
      });

      expect(report.checks[0].status).toBe(STATUS.OK);
    });

    it("port 9000 held by unrelated process → FAIL with occupant detail", async () => {
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 9876, command: "java", raw: "" });

      const { createSonarPortCheck } = await import("../../src/checks/ports.js");
      const report = await runChecks([createSonarPortCheck()], {
        config: { sonarqube: { enabled: true, host: "http://localhost:9000" } },
      });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].detail).toContain("java");
      expect(report.checks[0].detail).toContain("9876");
    });
  });

  describe("Node version manual-only", () => {
    it("Node 18 → FAIL with upgrade hint, remediation not attempted", async () => {
      const { createNodeVersionCheck } = await import("../../src/checks/node.js");
      const check = createNodeVersionCheck({ version: "v18.17.0" });
      const report = await runChecks([check], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].fix).toContain("nvm install");
    });

    it("Node 22 → OK", async () => {
      const { createNodeVersionCheck } = await import("../../src/checks/node.js");
      const check = createNodeVersionCheck({ version: "v22.0.0" });
      const report = await runChecks([check], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.OK);
    });
  });

  describe("Tokens (manual)", () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
      for (const k of Object.keys(process.env)) delete process.env[k];
      for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
    });

    it("ANTHROPIC_API_KEY missing with active anthropic role → FAIL", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const { getTokenChecks } = await import("../../src/checks/tokens.js");
      const checks = getTokenChecks({ roles: { coder: { provider: "claude" } } });
      const anth = checks.find((c) => c.name === "token:anthropic");
      const report = await runChecks([anth], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].fix).toContain("console.anthropic.com");
    });
  });

  describe("OpenSkills CLI", () => {
    it("missing + skills disabled → SKIPPED", async () => {
      const { createOpenSkillsCheck } = await import("../../src/checks/skills.js");
      const check = createOpenSkillsCheck();
      const report = await runChecks([check], { config: { skills: { enabled: false } } });

      expect(report.checks[0].status).toBe(STATUS.SKIPPED);
    });

    it("missing with skills enabled → WARN (soft failure, no nag)", async () => {
      const skillsClient = await import("../../src/skills/openskills-client.js");
      skillsClient.isOpenSkillsAvailable.mockResolvedValue(false);

      const { createOpenSkillsCheck } = await import("../../src/checks/skills.js");
      const report = await runChecks([createOpenSkillsCheck()], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.WARN);
    });
  });

  describe("check-only mode", () => {
    it("does not apply any remediation even when auto fixes are available", async () => {
      fsPromises.stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      fsPromises.mkdir.mockResolvedValue(undefined);

      const { createKarajanDirsCheck } = await import("../../src/checks/dir-setup.js");
      const report = await runChecks([createKarajanDirsCheck()], { config: {} }, { mode: "check-only" });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(fsPromises.mkdir).not.toHaveBeenCalled();
    });
  });

  describe("timeouts", () => {
    it("slow detect → TIMEOUT, not FAIL", async () => {
      const slowCheck = {
        name: "slow",
        label: "Slow check",
        strategy: "auto",
        detect: () => new Promise(() => {}),
        remediate: vi.fn(),
      };
      const report = await runChecks([slowCheck], { config: {} }, { timeoutMs: 25 });
      expect(report.checks[0].status).toBe(STATUS.TIMEOUT);
      expect(slowCheck.remediate).not.toHaveBeenCalled();
    });
  });
});
