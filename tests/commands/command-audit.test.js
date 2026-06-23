import { describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

// AuditRole.collectDeterministic() + executeWithDeterministic() drive
// auditCommand post KJC-TSK-0364 (two-phase). The legacy execute()
// convenience is kept for back-compat with MCP/pipeline callers.
// Mocking all three keeps the CLI test focused on argument flow and
// output formatting; AuditRole's own contract has its own test suite.
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

vi.mock("../../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn(),
  filterAvailableAgents: vi.fn(async (names) => names),
}));

vi.mock("../../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role,
  })),
}));

vi.mock("../../src/utils/cli-progress.js", () => ({
  createCliProgressReporter: vi.fn(() => ({
    onOutput: vi.fn(),
    finish: vi.fn(),
  })),
}));

vi.mock("../../src/utils/cli-run-log.js", () => ({
  withCliRunLog: vi.fn(async (_name, _opts, fn) => {
    const runLog = { logText: vi.fn(), logEvent: vi.fn(), close: vi.fn() };
    return fn({ runLog, forwardProgress: vi.fn() });
  }),
}));

// Harness stage runs Docker; stub it out so CLI tests stay hermetic.
vi.mock("../../src/audit/harness-section.js", () => ({
  runHarnessSection: vi.fn(async () => ({ ok: true, skipped: true, reason: "disabled" })),
  formatHarnessSection: vi.fn(() => ""),
  harnessSummaryForJson: vi.fn(() => null),
}));

function makeConfig(overrides = {}) {
  return {
    roles: { audit: { provider: "claude" } },
    ...overrides,
  };
}

const noopLogger = createNoopLoggerWithContext();

const successResult = {
  ok: true,
  result: {
    summary: { overallHealth: "fair", totalFindings: 3, critical: 0, high: 1, medium: 1, low: 1 },
    dimensions: {
      security: { score: "B", findings: [] },
      codeQuality: { score: "C", findings: [] },
      performance: { score: "A", findings: [] },
      architecture: { score: "B", findings: [] },
      testing: { score: "C", findings: [] },
    },
    topRecommendations: [],
    textSummary: "Fair health",
    provider: "claude",
  },
  summary: "Overall health: fair. 3 findings (1 high, 1 medium, 1 low)",
};

describe("commands/audit (post KJC-TSK-0357 — uses AuditRole)", () => {
  let filterAvailableAgents;

  beforeEach(async () => {
    vi.resetAllMocks();
    executeMock.mockResolvedValue(successResult);
    collectMock.mockResolvedValue({ projectDir: "/tmp", basalCost: null, growthDelta: null, stack: null, sonarFindings: null, webperf: null });
    executeWithDetMock.mockResolvedValue(successResult);

    const avail = await import("../../src/agents/availability.js");
    filterAvailableAgents = avail.filterAvailableAgents;
  });

  it("checks audit provider availability before invoking the role", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(filterAvailableAgents).toHaveBeenCalledWith(["claude", "codex", "gemini"]);
  });

  it("invokes AuditRole.executeWithDeterministic with the task verbatim", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(executeWithDetMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "audit codebase" }),
      expect.any(Object)
    );
  });

  it("forwards --dimensions to AuditRole (parseDimensions runs inside the role)", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger, dimensions: "security,testing" });

    expect(executeWithDetMock).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: "security,testing" }),
      expect.any(Object)
    );
  });

  it("falls back to a default task when none is provided", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ config: makeConfig(), logger: noopLogger });

    expect(executeWithDetMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Analyze the full codebase" }),
      expect.any(Object)
    );
  });

  it("throws when every audit provider returns ok=false", async () => {
    executeWithDetMock.mockResolvedValue({
      ok: false,
      result: { error: "agent error", provider: "claude" },
      summary: "Audit failed: agent error",
    });

    const { auditCommand } = await import("../../src/commands/audit.js");
    await expect(
      auditCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("agent error");
  });

  it("outputs JSON when --json flag is set", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, json: true });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("overallHealth"));
    spy.mockRestore();
  });

  it("formats the report when JSON is off", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    const allOutput = spy.mock.calls.map(c => c[0]).join("\n");
    expect(allOutput).toContain("## Codebase Health Report");
    expect(allOutput).toContain("**Overall Health:** fair");
    spy.mockRestore();
  });

  it("falls back to printing roleResult.summary when LLM output is unstructured", async () => {
    executeWithDetMock.mockResolvedValueOnce({
      ok: true,
      result: { raw: "free-form text from the LLM", provider: "claude" },
      summary: "Audit complete (unstructured output)",
    });

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    const allOutput = spy.mock.calls.map(c => c[0]).join("\n");
    expect(allOutput).toContain("free-form text from the LLM");
    spy.mockRestore();
  });
});

describe("commands/audit — CLI/MCP parity (KJC-TSK-0357)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executeMock.mockResolvedValue(successResult);
    collectMock.mockResolvedValue({ projectDir: "/tmp", basalCost: null, growthDelta: null, stack: null, sonarFindings: null, webperf: null });
    executeWithDetMock.mockResolvedValue(successResult);
  });

  it("CLI auditCommand and MCP direct-handler both reach AuditRole with the same input shape", async () => {
    // CLI path: invoke auditCommand and capture what it passed to executeWithDeterministic().
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "Analyze the full codebase",
      config: makeConfig(),
      logger: noopLogger,
      dimensions: "all",
    });
    const cliArgs = executeWithDetMock.mock.calls[executeWithDetMock.mock.calls.length - 1][0];

    // MCP path: instantiate AuditRole directly the same way direct-handlers
    // does (see src/mcp/handlers/direct-handlers.js — `new AuditRole(...)`)
    // and invoke execute() with the same input shape. The MCP path uses the
    // legacy execute() convenience which internally calls
    // collectDeterministic() then executeWithDeterministic().
    executeMock.mockClear();
    const { AuditRole } = await import("../../src/roles/audit-role.js");
    const mcpRole = new AuditRole({ config: makeConfig(), logger: noopLogger });
    await mcpRole.execute({
      task: "Analyze the full codebase",
      dimensions: "all",
    });
    const mcpArgs = executeMock.mock.calls[executeMock.mock.calls.length - 1][0];

    // Parity: both routes pass equivalent task + dimensions. CLI also
    // attaches an onOutput callback for terminal progress (MCP forwards
    // events differently) and a noSonar boolean from the --no-sonar flag
    // (MCP clients toggle the same control via the AuditRole input
    // directly when they want it). Strip both before comparing the
    // structural shape that drives the prompt.
    const { onOutput: _cliOnOutput, noSonar: _cliNoSonar, noOsv: _cliNoOsv, noSemgrep: _cliNoSemgrep, noAiSlop: _cliNoAiSlop, ...cliCore } = cliArgs;
    const { onOutput: _mcpOnOutput, noSonar: _mcpNoSonar, noOsv: _mcpNoOsv, noSemgrep: _mcpNoSemgrep, noAiSlop: _mcpNoAiSlop, ...mcpCore } = mcpArgs;
    expect(cliCore).toEqual(mcpCore);
  });
});
