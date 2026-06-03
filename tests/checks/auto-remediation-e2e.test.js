import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { STATUS } from "../../src/checks/types.js";

/**
 * End-to-end coverage of the auto-remediation flow: each realistic scenario
 * listed in the implementation plan of KJC-TSK-0319 gets an assertion so we
 * catch regressions in the detect → remediate → re-verify pipeline.
 */

vi.mock("../../src/sonar/discovery.js", () => ({
  discoverRunningSonar: vi.fn().mockResolvedValue({ found: false }),
}));

vi.mock("../../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn().mockResolvedValue(false),
}));

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
    // Re-establish defaults that resetAllMocks just wiped — the
    // sonar-port check now consults discovery + reachability and we
    // don't want stray undefined results sneaking into unrelated tests.
    const sonarDiscovery = await import("../../src/sonar/discovery.js");
    const sonarManager = await import("../../src/sonar/manager.js");
    sonarDiscovery.discoverRunningSonar.mockResolvedValue({ found: false });
    sonarManager.isSonarReachable.mockResolvedValue(false);
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

  describe("SonarQube port (auto-remediated)", () => {
    it("port 9000 held by a Sonar HTTP service → OK without remediation", async () => {
      // Simulate: port busy + docker discovery empty + HTTP probe says yes.
      portCheck.isPortAvailable.mockResolvedValue(false);
      const sonarManager = await import("../../src/sonar/manager.js");
      sonarManager.isSonarReachable.mockResolvedValue(true);

      const { createSonarPortCheck } = await import("../../src/checks/ports.js");
      const report = await runChecks([createSonarPortCheck()], {
        config: { sonarqube: { enabled: true, host: "http://localhost:9000" } },
      });

      expect(report.checks[0].status).toBe(STATUS.OK);
    });

    it("port 9000 held by an unrelated process → remediation produces a config override", async () => {
      // Simulate: configured port busy + nothing else found. Remediate
      // should produce a `changes.sonarqube.host` pointing at the next
      // free port. We assert on the remediation event, not on the final
      // verify status (re-verify reuses the same mocks, so once port
      // 9001 is mocked busy the second pass will fail too — but that's
      // a mock artefact, not the real behaviour we care about).
      portCheck.isPortAvailable.mockResolvedValue(false);
      portOcc.getPortOccupant.mockResolvedValue({ port: 9000, pid: 9876, command: "java", raw: "" });
      portCheck.findAvailablePort.mockResolvedValue(9001);

      const { createSonarPortCheck } = await import("../../src/checks/ports.js");
      const check = createSonarPortCheck();
      const detect = await check.detect({ config: { sonarqube: { host: "http://localhost:9000" } } });
      expect(detect.severity).toBe("warn");
      expect(detect.extra.remap.port).toBe(9001);

      const rem = await check.remediate({ extra: detect.extra });
      expect(rem.fixed).toBe(true);
      expect(rem.changes.sonarqube.host).toBe("http://localhost:9001");
    });
  });

  describe("Node version manual-only", () => {
    it("Node 20 → FAIL with upgrade hint, remediation not attempted (v3.0.0 dropped Node 20)", async () => {
      const { createNodeVersionCheck } = await import("../../src/checks/node.js");
      const check = createNodeVersionCheck({ version: "v20.18.0" });
      const report = await runChecks([check], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.FAIL);
      expect(report.checks[0].fix).toContain("nvm install");
    });

    it("Node 22 → OK (current minimum baseline since v3.0.0)", async () => {
      const { createNodeVersionCheck } = await import("../../src/checks/node.js");
      const check = createNodeVersionCheck({ version: "v22.22.1" });
      const report = await runChecks([check], { config: {} });

      expect(report.checks[0].status).toBe(STATUS.OK);
    });

    it("Node 24 → OK", async () => {
      const { createNodeVersionCheck } = await import("../../src/checks/node.js");
      const check = createNodeVersionCheck({ version: "v24.0.0" });
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

    it("anthropic CLI (`claude`) missing with active anthropic role → FAIL", async () => {
      // Post-v2.7.4: Karajan checks CLI binary on PATH, not env vars. The
      // env var ANTHROPIC_API_KEY was never read by Karajan in the first
      // place — agents spawn `claude` as a subprocess and the CLI handles
      // OAuth on its own. Test rewritten to mock the CLI as missing.
      vi.doMock("../../src/utils/agent-detect.js", () => ({
        checkBinary: vi.fn().mockResolvedValue({ ok: false }),
      }));
      vi.resetModules();
      const { getTokenChecks } = await import("../../src/checks/tokens.js");
      const checks = getTokenChecks({ roles: { coder: { provider: "claude" } } });
      const anth = checks.find((c) => c.name === "cli:anthropic");
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
