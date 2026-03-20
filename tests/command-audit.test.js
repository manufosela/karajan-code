import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role
  }))
}));

vi.mock("../src/prompts/audit.js", () => ({
  buildAuditPrompt: vi.fn().mockReturnValue("audit prompt"),
  parseAuditOutput: vi.fn().mockReturnValue({
    summary: { overallHealth: "fair", totalFindings: 3, critical: 0, high: 1, medium: 1, low: 1 },
    dimensions: {
      security: { score: "B", findings: [] },
      codeQuality: { score: "C", findings: [{ severity: "high", file: "src/foo.js", line: 10, rule: "SOLID-SRP", description: "Too many responsibilities", recommendation: "Split" }] },
      performance: { score: "A", findings: [] },
      architecture: { score: "B", findings: [] },
      testing: { score: "C", findings: [] }
    },
    topRecommendations: [{ priority: 1, dimension: "codeQuality", action: "Split god module", impact: "high", effort: "medium" }],
    textSummary: "Fair health"
  }),
  AUDIT_DIMENSIONS: ["security", "codeQuality", "performance", "architecture", "testing"]
}));

function makeConfig(overrides = {}) {
  return {
    roles: { audit: { provider: "claude" } },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/audit", () => {
  let createAgent, assertAgentsAvailable, buildAuditPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../src/prompts/audit.js");
    buildAuditPrompt = prompts.buildAuditPrompt;
    buildAuditPrompt.mockReturnValue("audit prompt");
    prompts.parseAuditOutput.mockReturnValue({
      summary: { overallHealth: "fair", totalFindings: 3, critical: 0, high: 1, medium: 1, low: 1 },
      dimensions: {
        security: { score: "B", findings: [] },
        codeQuality: { score: "C", findings: [] },
        performance: { score: "A", findings: [] },
        architecture: { score: "B", findings: [] },
        testing: { score: "C", findings: [] }
      },
      topRecommendations: [],
      textSummary: "Fair health"
    });

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"ok":true}', exitCode: 0 })
    });
  });

  it("asserts audit provider is available", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("builds prompt with task", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger });

    expect(buildAuditPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ task: "audit codebase" })
    );
  });

  it("filters dimensions when specified", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit codebase", config: makeConfig(), logger: noopLogger, dimensions: "security,testing" });

    expect(buildAuditPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: ["security", "testing"] })
    );
  });

  it("throws when audit fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "agent error", exitCode: 1 })
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

  it("maps quality shorthand to codeQuality", async () => {
    const { auditCommand } = await import("../src/commands/audit.js");
    await auditCommand({ task: "audit", config: makeConfig(), logger: noopLogger, dimensions: "quality" });

    expect(buildAuditPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: ["codeQuality"] })
    );
  });
});
