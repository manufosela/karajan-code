import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

// Mocks must be declared before imports of code-under-test that triggers
// the mocked modules. We import formatAudit/formatUsageSummary lazily
// inside each describe/it that needs them.
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
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
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

const { formatAudit, formatUsageSummary } = await import("../../src/commands/audit.js");

// Token/cost summary at end of audit — KJC-TSK-0363.

describe("formatUsageSummary (KJC-TSK-0363)", () => {
  it("returns null when no usage data is provided", () => {
    expect(formatUsageSummary(null)).toBeNull();
    expect(formatUsageSummary(undefined)).toBeNull();
  });

  it("renders provider + model + duration even when usage is unavailable", () => {
    const text = formatUsageSummary({
      available: false,
      provider: "gemini",
      model: "gemini-1.5-pro",
      durationMs: 2500,
      reason: 'provider "gemini" did not report token usage',
    });
    expect(text).toContain("Provider: gemini (gemini-1.5-pro)");
    expect(text).toContain("Duration: 2.5s");
    expect(text).toContain("usage data not available");
    expect(text).toContain("did not report token usage");
  });

  it("renders tokens + cost when available (claude-style result)", () => {
    const text = formatUsageSummary({
      available: true,
      provider: "claude",
      model: "claude-sonnet-4-6",
      tokens_in: 12345,
      tokens_out: 678,
      total_tokens: 13023,
      cost_usd: 0.0421,
      durationMs: 18400,
    });
    expect(text).toContain("Provider: claude (claude-sonnet-4-6)");
    expect(text).toContain("Duration: 18.4s");
    expect(text).toContain("Tokens: 13,023 total (12,345 in, 678 out)");
    expect(text).toContain("Estimated cost: $0.0421 USD");
  });

  it("omits cost line when cost_usd is null but still shows tokens", () => {
    const text = formatUsageSummary({
      available: true,
      provider: "codex",
      tokens_in: 100,
      tokens_out: 50,
      total_tokens: 150,
      cost_usd: null,
      durationMs: 1000,
    });
    expect(text).toContain("Tokens: 150 total");
    expect(text).not.toContain("Estimated cost");
  });
});

describe("formatAudit appends LLM Usage section when usage is provided", () => {
  const parsed = {
    summary: { overallHealth: "fair", totalFindings: 1, critical: 0, high: 1, medium: 0, low: 0 },
    dimensions: {
      security: { score: "B", findings: [] },
      codeQuality: { score: "B", findings: [] },
      performance: { score: "A", findings: [] },
      architecture: { score: "B", findings: [] },
      testing: { score: "B", findings: [] },
      accessibility: { score: "C", findings: [{ severity: "high", file: "x.html", line: 1, rule: "WCAG-1.1.1", description: "Missing alt", recommendation: "Add alt" }] },
    },
    topRecommendations: [],
    textSummary: "Decent.",
  };

  it("renders the LLM Usage section after the existing report", () => {
    const text = formatAudit(parsed, {
      available: true,
      provider: "claude",
      model: "claude-sonnet-4-6",
      tokens_in: 12000,
      tokens_out: 800,
      total_tokens: 12800,
      cost_usd: 0.0432,
      durationMs: 17500,
    });
    expect(text).toContain("## Codebase Health Report");
    expect(text).toContain("## LLM Usage");
    expect(text.indexOf("## LLM Usage")).toBeGreaterThan(text.indexOf("## Codebase Health Report"));
    expect(text).toContain("Tokens: 12,800 total");
  });

  it("omits the LLM Usage section when usage is null (back-compat)", () => {
    const text = formatAudit(parsed);
    expect(text).not.toContain("## LLM Usage");
  });

  it("renders 'usage data not available' for providers that don't report tokens", () => {
    const text = formatAudit(parsed, {
      available: false,
      provider: "aider",
      durationMs: 9100,
      reason: 'provider "aider" did not report token usage',
    });
    expect(text).toContain("## LLM Usage");
    expect(text).toContain("usage data not available");
  });
});

// Integration via auditCommand path: confirm the section lands in stdout
// + the JSON output + the markdown report-file. AuditRole is mocked at
// the top of the file so this section just exercises auditCommand.
const noopLogger = createNoopLoggerWithContext();
const exampleUsage = {
  available: true, provider: "claude", model: "claude-sonnet-4-6",
  tokens_in: 1234, tokens_out: 567, total_tokens: 1801, cost_usd: 0.0123, durationMs: 5500,
};
const successResult = {
  ok: true,
  result: {
    summary: { overallHealth: "fair", totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0 },
    dimensions: { security: { score: "A", findings: [] }, codeQuality: { score: "A", findings: [] }, performance: { score: "A", findings: [] }, architecture: { score: "A", findings: [] }, testing: { score: "A", findings: [] }, accessibility: { score: "A", findings: [] } },
    topRecommendations: [],
    provider: "claude",
  },
  summary: "Overall health: fair. 0 findings.",
  usage: exampleUsage,
};

describe("auditCommand integration — usage flows through CLI/JSON/report-file", () => {
  let tmpDir;
  let consoleSpy;

  beforeEach(async () => {
    vi.resetAllMocks();
    executeMock.mockResolvedValue(successResult);
    collectMock.mockResolvedValue({ projectDir: "/tmp", basalCost: null, growthDelta: null, stack: null, sonarFindings: null, webperf: null });
    executeWithDetMock.mockResolvedValue(successResult);
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-audit-usage-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeConfig() { return { roles: { audit: { provider: "claude" } }, projectDir: tmpDir }; }

  it("appends LLM Usage section to stdout in markdown mode", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("## LLM Usage");
    expect(stdout).toContain("Tokens: 1,801 total");
  });

  it("includes usage as a top-level key in JSON output", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, json: true });

    const stdoutJson = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(stdoutJson.usage).toBeDefined();
    expect(stdoutJson.usage.tokens_in).toBe(1234);
    expect(stdoutJson.usage.cost_usd).toBe(0.0123);
  });

  it("writes the usage section into a markdown report-file", async () => {
    const target = path.join(tmpDir, "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target });

    const written = await fs.readFile(target, "utf8");
    expect(written).toContain("## LLM Usage");
    expect(written).toContain("Tokens: 1,801 total");
    expect(written).toContain("Estimated cost: $0.0123 USD");
  });

  it("writes the usage as a top-level key into a json report-file", async () => {
    const target = path.join(tmpDir, "audit.json");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, reportFile: target, json: true });

    const written = JSON.parse(await fs.readFile(target, "utf8"));
    expect(written.usage.total_tokens).toBe(1801);
  });
});
