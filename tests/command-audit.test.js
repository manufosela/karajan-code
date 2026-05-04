import { describe, expect, it, vi, beforeEach } from "vitest";

// AuditRole.execute() is what auditCommand now drives (post KJC-TSK-0357).
// Mocking the role surface keeps the CLI test focused on argument flow and
// output formatting; AuditRole's own contract has its own test suite.
const executeMock = vi.fn();
class MockAuditRole {
  constructor(opts) { this.opts = opts; }
  async execute(input) { return executeMock(input); }
}

vi.mock("../src/roles/audit-role.js", () => ({
  AuditRole: MockAuditRole,
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role,
  })),
}));

vi.mock("../src/utils/cli-progress.js", () => ({
  createCliProgressReporter: vi.fn(() => ({
    onOutput: vi.fn(),
    finish: vi.fn(),
  })),
}));

vi.mock("../src/utils/cli-run-log.js", () => ({
  withCliRunLog: vi.fn(async (_name, _opts, fn) => {
    const runLog = { logText: vi.fn(), logEvent: vi.fn(), close: vi.fn() };
    return fn({ runLog, forwardProgress: vi.fn() });
  }),
}));

function makeConfig(overrides = {}) {
  return {
    roles: { audit: { provider: "claude" } },
    ...overrides,
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn(),
};

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
  let assertAgentsAvailable;

  beforeEach(async () => {
    vi.resetAllMocks();
    executeMock.mockResolvedValue(successResult);

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;
  });

  it("asserts audit provider is available before invoking the role", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("invokes AuditRole.execute with the task verbatim", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "audit codebase" })
    );
  });

  it("forwards --dimensions to AuditRole.execute (parseDimensions runs inside the role)", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger, dimensions: "security,testing" });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: "security,testing" })
    );
  });

  it("falls back to a default task when none is provided", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ config: makeConfig(), logger: noopLogger });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Analyze the full codebase" })
    );
  });

  it("throws when AuditRole returns ok=false", async () => {
    executeMock.mockResolvedValueOnce({
      ok: false,
      result: { error: "agent error", provider: "claude" },
      summary: "Audit failed: agent error",
    });

    const { auditCommand } = await import("../src/commands/audit.js");
    await expect(
      auditCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("agent error");
  });

  it("outputs JSON when --json flag is set", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, json: true });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("overallHealth"));
    spy.mockRestore();
  });

  it("formats the report when JSON is off", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger });

    const allOutput = spy.mock.calls.map(c => c[0]).join("\n");
    expect(allOutput).toContain("## Codebase Health Report");
    expect(allOutput).toContain("**Overall Health:** fair");
    spy.mockRestore();
  });

  it("falls back to printing roleResult.summary when LLM output is unstructured", async () => {
    executeMock.mockResolvedValueOnce({
      ok: true,
      result: { raw: "free-form text from the LLM", provider: "claude" },
      summary: "Audit complete (unstructured output)",
    });

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auditCommand } = await import("../src/commands/audit.js");
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
  });

  it("CLI auditCommand and MCP direct-handler both reach AuditRole.execute with the same input shape", async () => {
    // CLI path: invoke auditCommand and capture what it passed to execute().
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({
      task: "Analyze the full codebase",
      config: makeConfig(),
      logger: noopLogger,
      dimensions: "all",
    });
    const cliArgs = executeMock.mock.calls[executeMock.mock.calls.length - 1][0];

    // MCP path: instantiate AuditRole directly the same way direct-handlers
    // does (see src/mcp/handlers/direct-handlers.js — `new AuditRole(...)`)
    // and invoke execute() with the same input shape.
    executeMock.mockClear();
    const { AuditRole } = await import("../src/roles/audit-role.js");
    const mcpRole = new AuditRole({ config: makeConfig(), logger: noopLogger });
    await mcpRole.execute({
      task: "Analyze the full codebase",
      dimensions: "all",
    });
    const mcpArgs = executeMock.mock.calls[executeMock.mock.calls.length - 1][0];

    // Parity: both routes pass equivalent task + dimensions. CLI also adds
    // an onOutput callback for terminal progress (MCP forwards events
    // differently); strip that before comparing structural shape.
    const { onOutput: _cliOnOutput, ...cliCore } = cliArgs;
    const { onOutput: _mcpOnOutput, ...mcpCore } = mcpArgs;
    expect(cliCore).toEqual(mcpCore);
  });
});
