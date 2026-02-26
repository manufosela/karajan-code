import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { ROLE_EVENTS } from "../src/roles/base-role.js";

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn()
}));

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn(),
  getOpenIssues: vi.fn()
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  shouldBlockByProfile: vi.fn(),
  summarizeIssues: vi.fn()
}));

const { SonarRole } = await import("../src/roles/sonar-role.js");
const { runSonarScan } = await import("../src/sonar/scanner.js");
const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
const { shouldBlockByProfile, summarizeIssues } = await import("../src/sonar/enforcer.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

const sampleIssues = [
  { severity: "CRITICAL", type: "BUG", component: "src/foo.js", line: 10, rule: "js:S1234", message: "Null pointer" },
  { severity: "MAJOR", type: "CODE_SMELL", component: "src/bar.js", line: 25, rule: "js:S5678", message: "Unused var" }
];

describe("SonarRole", () => {
  let emitter;
  const config = {
    sonarqube: {
      enabled: true,
      enforcement_profile: "pragmatic"
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    emitter = new EventEmitter();

    runSonarScan.mockResolvedValue({
      ok: true,
      projectKey: "kj-test-project",
      stdout: "Analysis complete",
      stderr: "",
      exitCode: 0
    });

    getQualityGateStatus.mockResolvedValue({
      ok: true,
      status: "OK",
      raw: {}
    });

    getOpenIssues.mockResolvedValue({
      total: 0,
      issues: [],
      raw: {}
    });

    shouldBlockByProfile.mockReturnValue(false);
    summarizeIssues.mockReturnValue("");
  });

  it("extends BaseRole and has name 'sonar'", () => {
    const role = new SonarRole({ config, logger });
    expect(role.name).toBe("sonar");
  });

  it("requires init() before run()", async () => {
    const role = new SonarRole({ config, logger });
    await expect(role.run()).rejects.toThrow("init() must be called before run()");
  });

  it("executes scan, quality gate, and issues on run", async () => {
    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(runSonarScan).toHaveBeenCalledWith(config);
    expect(getQualityGateStatus).toHaveBeenCalledWith(config, "kj-test-project");
    expect(getOpenIssues).toHaveBeenCalledWith(config, "kj-test-project");
    expect(output.ok).toBe(true);
  });

  it("returns ok=true when quality gate passes", async () => {
    shouldBlockByProfile.mockReturnValue(false);

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.ok).toBe(true);
    expect(output.result.gateStatus).toBe("OK");
    expect(output.result.blocking).toBe(false);
  });

  it("returns ok=false when quality gate blocks", async () => {
    getQualityGateStatus.mockResolvedValue({ ok: true, status: "ERROR", raw: {} });
    shouldBlockByProfile.mockReturnValue(true);

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.ok).toBe(false);
    expect(output.result.gateStatus).toBe("ERROR");
    expect(output.result.blocking).toBe(true);
  });

  it("returns ok=false when scan fails", async () => {
    runSonarScan.mockResolvedValue({
      ok: false,
      projectKey: null,
      stdout: "",
      stderr: "Docker not running",
      exitCode: 1
    });

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.ok).toBe(false);
    expect(output.summary).toContain("scan failed");
    expect(getQualityGateStatus).not.toHaveBeenCalled();
  });

  it("includes issues classified by severity in output", async () => {
    getOpenIssues.mockResolvedValue({ total: 2, issues: sampleIssues, raw: {} });
    summarizeIssues.mockReturnValue("CRITICAL: 1, MAJOR: 1");

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.result.issues).toHaveLength(2);
    expect(output.result.issues[0]).toEqual({
      severity: "CRITICAL",
      type: "BUG",
      file: "src/foo.js",
      line: 10,
      rule: "js:S1234",
      message: "Null pointer"
    });
    expect(output.result.issues[1]).toEqual({
      severity: "MAJOR",
      type: "CODE_SMELL",
      file: "src/bar.js",
      line: 25,
      rule: "js:S5678",
      message: "Unused var"
    });
  });

  it("calls shouldBlockByProfile with correct profile", async () => {
    const customConfig = {
      sonarqube: { enabled: true, enforcement_profile: "paranoid" }
    };
    const role = new SonarRole({ config: customConfig, logger });
    await role.init({});
    await role.run();

    expect(shouldBlockByProfile).toHaveBeenCalledWith({
      gateStatus: "OK",
      profile: "paranoid"
    });
  });

  it("includes issuesSummary from summarizeIssues", async () => {
    getOpenIssues.mockResolvedValue({ total: 3, issues: sampleIssues, raw: {} });
    summarizeIssues.mockReturnValue("CRITICAL: 1, MAJOR: 2");

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.result.issuesSummary).toBe("CRITICAL: 1, MAJOR: 2");
  });

  it("emits role:start and role:end events", async () => {
    const events = [];
    emitter.on(ROLE_EVENTS.START, (e) => events.push({ type: "start", ...e }));
    emitter.on(ROLE_EVENTS.END, (e) => events.push({ type: "end", ...e }));

    const role = new SonarRole({ config, logger, emitter });
    await role.init({ iteration: 1 });
    await role.run();

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[0].role).toBe("sonar");
    expect(events[1].type).toBe("end");
  });

  it("emits role:error when scan throws", async () => {
    runSonarScan.mockRejectedValue(new Error("Docker daemon not running"));

    const events = [];
    emitter.on(ROLE_EVENTS.ERROR, (e) => events.push(e));

    const role = new SonarRole({ config, logger, emitter });
    await role.init({});
    await expect(role.run()).rejects.toThrow("Docker daemon not running");

    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("Docker daemon not running");
  });

  it("report() returns structured sonar report", async () => {
    const role = new SonarRole({ config, logger });
    await role.init({});
    await role.run();

    const report = role.report();
    expect(report.role).toBe("sonar");
    expect(report.ok).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("includes projectKey in result", async () => {
    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.result.projectKey).toBe("kj-test-project");
  });

  it("includes openIssuesTotal in result", async () => {
    getOpenIssues.mockResolvedValue({ total: 5, issues: sampleIssues, raw: {} });

    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.result.openIssuesTotal).toBe(5);
  });

  it("works without emitter", async () => {
    const role = new SonarRole({ config, logger });
    await role.init({});
    const output = await role.run();

    expect(output.ok).toBe(true);
  });

  it("does not require createAgentFn (non-AI role)", () => {
    const role = new SonarRole({ config, logger });
    expect(role).toBeDefined();
    expect(role.name).toBe("sonar");
  });
});
