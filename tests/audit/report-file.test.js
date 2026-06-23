import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

// Reuse the same AuditRole mocking strategy as tests/command-audit.test.js
// so this file can drive auditCommand through the report-file branch
// without spinning up an LLM. Post KJC-TSK-0364 the role exposes both
// the legacy execute() AND the two-phase split (collectDeterministic +
// executeWithDeterministic). All three are mocked.
const executeMock = vi.fn();
const collectMock = vi.fn();
const executeWithDetMock = vi.fn();

vi.mock("../../src/roles/audit-role.js", () => ({
  AuditRole: class {
    constructor(opts) { this.opts = opts; }
    async execute(input) { return executeMock(input); }
    async collectDeterministic(input) { return collectMock(input); }
    async executeWithDeterministic(input, ctx) { return executeWithDetMock(input, ctx); }
  },
}));
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn(), filterAvailableAgents: vi.fn(async (names) => names) }));
vi.mock("../../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({ provider: config.roles?.[role]?.provider || role })),
}));
vi.mock("../../src/utils/cli-progress.js", () => ({
  createCliProgressReporter: vi.fn(() => ({ onOutput: vi.fn(), finish: vi.fn() })),
}));
vi.mock("../../src/utils/cli-run-log.js", () => ({
  withCliRunLog: vi.fn(async (_name, _opts, fn) => {
    const runLog = { logText: vi.fn(), logEvent: vi.fn(), close: vi.fn() };
    return fn({ runLog, forwardProgress: vi.fn() });
  }),
}));
vi.mock("../../src/audit/harness-section.js", () => ({
  runHarnessSection: vi.fn(async () => ({ ok: true, skipped: true, reason: "disabled" })),
  formatHarnessSection: vi.fn(() => ""),
  harnessSummaryForJson: vi.fn(() => null),
}));

const noopLogger = createNoopLoggerWithContext();

const successResult = {
  ok: true,
  result: {
    summary: { overallHealth: "fair", totalFindings: 1, critical: 0, high: 1, medium: 0, low: 0 },
    dimensions: {
      security: { score: "B", findings: [] },
      codeQuality: { score: "C", findings: [{ severity: "high", file: "src/foo.js", line: 10, rule: "AUDIT-Q-1", description: "God module", recommendation: "Split" }] },
      performance: { score: "A", findings: [] },
      architecture: { score: "B", findings: [] },
      testing: { score: "C", findings: [] },
    },
    topRecommendations: [],
    textSummary: "Fair health",
    provider: "claude",
  },
  summary: "Overall health: fair. 1 findings (1 high)",
};

let tmpDir;
let consoleSpy;

beforeEach(async () => {
  vi.resetAllMocks();
  executeMock.mockResolvedValue(successResult);
  collectMock.mockResolvedValue({ projectDir: "/tmp", basalCost: null, growthDelta: null, stack: null, sonarFindings: null, webperf: null });
  executeWithDetMock.mockResolvedValue(successResult);
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-audit-report-"));
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  delete process.env.KJ_AUDIT_REPORT_DIR;
});

afterEach(async () => {
  consoleSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_AUDIT_REPORT_DIR;
});

function makeConfig(overrides = {}) {
  return { roles: { audit: { provider: "claude" } }, projectDir: tmpDir, ...overrides };
}

describe("kj audit --report-file (KJC-TSK-0362)", () => {
  it("zero behaviour change when --report-file is absent and env unset", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    expect(result.reportPath).toBeUndefined();
    const files = (await fs.readdir(tmpDir)).filter((f) => f !== ".karajan"); // .karajan/audit-history.db expected (TSK-0472)
    expect(files).toHaveLength(0);
  });

  it("writes a markdown report when --report-file is a .md path", async () => {
    const target = path.join(tmpDir, "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target });

    expect(result.reportPath).toBe(target);
    const content = await fs.readFile(target, "utf8");
    expect(content).toContain("# Karajan Audit Report");
    expect(content).toContain("## Codebase Health Report");
    expect(content).toContain("**Overall Health:** fair");
    expect(content).toContain("- **Generated:**");
  });

  it("writes a JSON report when --report-file is a .json path", async () => {
    const target = path.join(tmpDir, "audit.json");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target, json: true });

    const content = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.summary.overallHealth).toBe("fair");
    expect(parsed.dimensions.codeQuality.findings[0].rule).toBe("AUDIT-Q-1");
  });

  it("writes a timestamped file inside a directory target", async () => {
    const reportsDir = path.join(tmpDir, "reports");
    await fs.mkdir(reportsDir, { recursive: true });
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: reportsDir });

    expect(result.reportPath).toMatch(/\/reports\/audit-\d{4}-\d{2}-\d{2}T.*\.md$/);
    const written = await fs.readFile(result.reportPath, "utf8");
    expect(written).toContain("# Karajan Audit Report");
  });

  it("creates parent directories on demand", async () => {
    const target = path.join(tmpDir, "deeply", "nested", "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target });

    const content = await fs.readFile(target, "utf8");
    expect(content).toContain("# Karajan Audit Report");
  });

  it("uses $KJ_AUDIT_REPORT_DIR as default directory when --report-file is absent", async () => {
    const reportsDir = path.join(tmpDir, "env-reports");
    await fs.mkdir(reportsDir, { recursive: true });
    process.env.KJ_AUDIT_REPORT_DIR = reportsDir;

    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    expect(result.reportPath).toMatch(/\/env-reports\/audit-.+\.md$/);
  });

  it("explicit --report-file beats $KJ_AUDIT_REPORT_DIR", async () => {
    const envDir = path.join(tmpDir, "env-reports");
    await fs.mkdir(envDir, { recursive: true });
    process.env.KJ_AUDIT_REPORT_DIR = envDir;

    const explicit = path.join(tmpDir, "explicit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: explicit });

    expect(result.reportPath).toBe(explicit);
    const envFiles = await fs.readdir(envDir);
    expect(envFiles).toHaveLength(0);
  });

  it("markdown header includes invocation flags when present", async () => {
    const target = path.join(tmpDir, "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "Quality only",
      config: makeConfig(),
      logger: noopLogger,
      dimensions: "quality",
      noSonar: true,
      reportFile: target,
    });

    const content = await fs.readFile(target, "utf8");
    expect(content).toContain("--dimensions=quality");
    expect(content).toContain("--no-sonar");
    expect(content).toContain('"Quality only"');
  });

  it("still prints the report to stdout in addition to writing the file", async () => {
    const target = path.join(tmpDir, "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target });

    const stdoutText = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdoutText).toContain("## Codebase Health Report");
  });
});
