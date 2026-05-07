import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the sonar surface so we can drive collectSonarFindings under
// controlled conditions without spinning up a real SonarQube container.
vi.mock("../../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn(),
}));
vi.mock("../../src/sonar/api.js", () => ({
  getOpenIssues: vi.fn(),
  getQualityGateStatus: vi.fn(),
}));
// Stub runCommand so the silent-skip "no git remote" path is
// deterministic — we don't want the test to depend on whatever git
// remote happens to be configured in the working tree.
vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

import { collectSonarFindings, groupIssuesBySeverity } from "../../src/audit/sonar-findings.js";
import { isSonarReachable } from "../../src/sonar/manager.js";
import { getOpenIssues, getQualityGateStatus } from "../../src/sonar/api.js";
import { runCommand } from "../../src/utils/process.js";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

const baseConfig = { sonarqube: { host: "http://localhost:9000" } };
const noopLogger = { warn: vi.fn(), info: vi.fn() };

// Default git-remote stub: pretend the working tree HAS a remote so the
// existing tests (written before the silent-skip path) keep exercising
// the happy-path Sonar API code. Per-test overrides cover the new path.
function stubGitRemote(remoteUrl) {
  runCommand.mockImplementation(async () => ({
    exitCode: remoteUrl ? 0 : 1,
    stdout: remoteUrl || "",
    stderr: "",
  }));
}

describe("collectSonarFindings (KJC-TSK-0361)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubGitRemote("git@github.com:manufosela/karajan-code.git");
  });
  afterEach(() => {
    delete process.env.KJ_SONAR_PROJECT_KEY;
  });

  it("returns available=false when sonar host is unreachable (no API call attempted)", async () => {
    isSonarReachable.mockResolvedValue(false);

    const r = await collectSonarFindings(baseConfig, noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not reachable/);
    expect(getOpenIssues).not.toHaveBeenCalled();
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it("returns available=false when isSonarReachable rejects (defensive catch)", async () => {
    isSonarReachable.mockRejectedValue(new Error("dns lookup failed"));

    const r = await collectSonarFindings(baseConfig, noopLogger);
    expect(r.available).toBe(false);
  });

  it("returns the issues + quality gate when sonar is reachable", async () => {
    isSonarReachable.mockResolvedValue(true);
    getOpenIssues.mockResolvedValue({
      total: 2,
      issues: [
        { rule: "squid:S1234", severity: "MAJOR", component: "src/foo.js", line: 12, message: "Cognitive complexity too high" },
        { rule: "squid:S5678", severity: "BLOCKER", component: "src/bar.js", line: 1, message: "Hardcoded secret" },
      ],
    });
    getQualityGateStatus.mockResolvedValue({ ok: true, status: "ERROR", conditions: [] });

    const r = await collectSonarFindings(baseConfig);
    expect(r.available).toBe(true);
    expect(r.total).toBe(2);
    expect(r.issues).toHaveLength(2);
    expect(r.qualityGate.status).toBe("ERROR");
  });

  it("survives quality-gate fetch failure (returns issues without QG)", async () => {
    isSonarReachable.mockResolvedValue(true);
    getOpenIssues.mockResolvedValue({ total: 0, issues: [] });
    getQualityGateStatus.mockRejectedValue(new Error("project not yet analysed"));

    const r = await collectSonarFindings(baseConfig);
    expect(r.available).toBe(true);
    expect(r.qualityGate).toBeNull();
  });

  it("returns available=false when getOpenIssues throws", async () => {
    isSonarReachable.mockResolvedValue(true);
    getOpenIssues.mockRejectedValue(new Error("401 unauthorized"));

    const r = await collectSonarFindings(baseConfig, noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/getOpenIssues failed/);
  });

  // KJC-TSK-0373 — silent-skip path. When the working tree has no
  // git remote AND no explicit project_key, Sonar simply doesn't
  // apply: we mustn't hit the API (which would 404 noisy) and we
  // mustn't surface a "Missing git remote" warning to the user.
  describe("silent-skip when sonar can't be addressed (KJC-TSK-0373)", () => {
    it("returns 'not applicable' when git has no remote and no project_key is configured", async () => {
      isSonarReachable.mockResolvedValue(true);
      stubGitRemote(null); // git config exitCode 1 = no remote.origin.url

      const r = await collectSonarFindings(baseConfig, noopLogger);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/not applicable/);
      expect(r.reason).toMatch(/no git remote/);
      // The whole point: don't call the Sonar API and don't warn.
      expect(getOpenIssues).not.toHaveBeenCalled();
      expect(noopLogger.warn).not.toHaveBeenCalled();
    });

    it("bypasses the git-remote check when sonarqube.project_key is set in config", async () => {
      isSonarReachable.mockResolvedValue(true);
      stubGitRemote(null); // even with no remote...
      getOpenIssues.mockResolvedValue({ total: 0, issues: [] });
      getQualityGateStatus.mockResolvedValue({ ok: true, status: "OK", conditions: [] });

      const r = await collectSonarFindings(
        { sonarqube: { host: "http://localhost:9000", project_key: "explicit-key" } },
      );
      // ...the explicit project_key short-circuits the skip.
      expect(r.available).toBe(true);
      expect(getOpenIssues).toHaveBeenCalled();
    });

    it("bypasses the git-remote check when KJ_SONAR_PROJECT_KEY env var is set", async () => {
      process.env.KJ_SONAR_PROJECT_KEY = "env-key";
      isSonarReachable.mockResolvedValue(true);
      stubGitRemote(null);
      getOpenIssues.mockResolvedValue({ total: 0, issues: [] });
      getQualityGateStatus.mockResolvedValue({ ok: true, status: "OK", conditions: [] });

      const r = await collectSonarFindings(baseConfig);
      expect(r.available).toBe(true);
      expect(getOpenIssues).toHaveBeenCalled();
    });

    it("treats whitespace-only project_key as 'no override' and falls through to the git check", async () => {
      // Defensive: an env var like `export KJ_SONAR_PROJECT_KEY=" "`
      // should NOT count as a real override. The user almost
      // certainly meant "unset", and triggering the API with an
      // empty key would return 404.
      process.env.KJ_SONAR_PROJECT_KEY = "   ";
      isSonarReachable.mockResolvedValue(true);
      stubGitRemote(null);

      const r = await collectSonarFindings(baseConfig, noopLogger);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/not applicable/);
      expect(getOpenIssues).not.toHaveBeenCalled();
    });
  });
});

describe("groupIssuesBySeverity", () => {
  it("groups issues into Sonar's canonical severity order (BLOCKER first)", () => {
    const groups = groupIssuesBySeverity([
      { severity: "MAJOR", message: "a" },
      { severity: "BLOCKER", message: "b" },
      { severity: "INFO", message: "c" },
      { severity: "MAJOR", message: "d" },
    ]);
    expect(Object.keys(groups)).toEqual(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]);
    expect(groups.BLOCKER).toHaveLength(1);
    expect(groups.MAJOR).toHaveLength(2);
    expect(groups.INFO).toHaveLength(1);
  });

  it("buckets unknown severity into INFO", () => {
    const groups = groupIssuesBySeverity([{ severity: "MYSTERY" }, {}]);
    expect(groups.INFO).toHaveLength(2);
  });
});

describe("buildAuditPrompt — Sonar section integration", () => {
  it("omits the section when sonarFindings is null or unavailable", () => {
    const a = buildAuditPrompt({ task: "audit", sonarFindings: null });
    const b = buildAuditPrompt({ task: "audit", sonarFindings: { available: false, reason: "down" } });
    expect(a).not.toContain("## SonarQube Findings");
    expect(b).not.toContain("## SonarQube Findings");
  });

  it("renders findings grouped by severity with rule + location", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      sonarFindings: {
        available: true,
        total: 2,
        issues: [
          { rule: "squid:S1234", severity: "MAJOR", component: "src/foo.js", line: 12, message: "Cognitive complexity too high" },
          { rule: "squid:S5678", severity: "BLOCKER", component: "src/bar.js", line: 1, message: "Hardcoded secret" },
        ],
        qualityGate: { status: "ERROR", conditions: [] },
      },
    });
    expect(prompt).toContain("## SonarQube Findings");
    expect(prompt).toContain("Quality gate: ERROR");
    expect(prompt).toContain("Total open issues: 2");
    expect(prompt).toContain("### BLOCKER (1)");
    expect(prompt).toContain("### MAJOR (1)");
    expect(prompt).toContain("squid:S1234");
    expect(prompt).toContain("Cross-reference these with your own findings");
  });

  it("caps the rendered issue list at MAX_SONAR_ISSUES_IN_PROMPT (50) with overflow line", () => {
    const issues = Array.from({ length: 75 }, (_, i) => ({
      rule: `squid:R${i}`, severity: "MAJOR", component: `f${i}.js`, line: i, message: `m${i}`,
    }));
    const prompt = buildAuditPrompt({
      task: "audit",
      sonarFindings: { available: true, total: 75, issues },
    });
    expect(prompt).toContain("Total open issues: 75");
    expect(prompt).toContain("and 25 more in MAJOR");
  });

  it("renders only the quality-gate line when there are zero open issues but a gate result exists", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      sonarFindings: { available: true, total: 0, issues: [], qualityGate: { status: "OK", conditions: [] } },
    });
    expect(prompt).toContain("Quality gate: OK");
    expect(prompt).not.toContain("### BLOCKER");
  });
});
