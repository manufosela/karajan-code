import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { formatDeterministicSummary, deterministicContextHasFindings } from "../../src/audit/deterministic-summary.js";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

// Two-phase audit (deterministic first, ask before LLM) — KJC-TSK-0364.

const collectMock = vi.fn();
const executeWithDetMock = vi.fn();

vi.mock("../../src/roles/audit-role.js", () => ({
  AuditRole: class {
    constructor(opts) { this.opts = opts; }
    async collectDeterministic(input) { return collectMock(input); }
    async executeWithDeterministic(input, ctx) { return executeWithDetMock(input, ctx); }
    async execute(input) { const ctx = await this.collectDeterministic(input); return this.executeWithDeterministic(input, ctx); }
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
vi.mock("../../src/audit/harness-section.js", () => ({
  runHarnessSection: vi.fn(async () => ({ ok: true, skipped: true, reason: "disabled" })),
  formatHarnessSection: vi.fn(() => ""),
  harnessSummaryForJson: vi.fn(() => null),
}));

const sampleDeterministicCtx = {
  projectDir: "/tmp/x",
  basalCost: { totalLines: 5000, totalFiles: 80, dependencies: { total: 12, dependencies: 5, devDependencies: 7 }, deadExports: [{ name: "unused", file: "src/dead.js" }], unusedDependencies: { unused: ["lodash"] } },
  growthDelta: { lines: 200, files: 5, deps: 1, since: "2026-04-01" },
  stack: { language: "javascript", frameworks: ["astro"], isFrontend: true, isBackend: false, isFullstack: false },
  sonarFindings: { available: true, total: 1, issues: [{ rule: "squid:S1234", severity: "MAJOR", component: "src/foo.js", line: 1, message: "complexity" }], qualityGate: { status: "OK" } },
  webperf: { available: true, mode: "static-hints" },
};

const successResult = {
  ok: true,
  result: {
    summary: { overallHealth: "fair", totalFindings: 1, critical: 0, high: 1, medium: 0, low: 0 },
    dimensions: { security: { score: "B", findings: [] }, codeQuality: { score: "B", findings: [] }, performance: { score: "A", findings: [] }, architecture: { score: "B", findings: [] }, testing: { score: "B", findings: [] }, accessibility: { score: "C", findings: [] } },
    topRecommendations: [],
    provider: "claude",
  },
  summary: "Overall health: fair. 1 findings (1 high)",
  usage: { available: true, provider: "claude", model: "claude-sonnet-4-6", tokens_in: 1000, tokens_out: 200, total_tokens: 1200, cost_usd: 0.005, durationMs: 4500 },
};

const noopLogger = createNoopLoggerWithContext();

let tmpDir;
let consoleSpy;

beforeEach(async () => {
  vi.resetAllMocks();
  collectMock.mockResolvedValue(sampleDeterministicCtx);
  executeWithDetMock.mockResolvedValue(successResult);
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-audit-2phase-"));
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  consoleSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeConfig() { return { roles: { audit: { provider: "claude" } }, projectDir: tmpDir }; }

describe("formatDeterministicSummary (KJC-TSK-0364)", () => {
  it("renders all sections when full context is available", () => {
    const md = formatDeterministicSummary(sampleDeterministicCtx);
    expect(md).toContain("## Deterministic Findings");
    expect(md).toContain("### Project Stack");
    expect(md).toContain("Frameworks: astro");
    expect(md).toContain("### Basal Cost");
    expect(md).toContain("Source: 5000 lines across 80 files");
    expect(md).toContain("Dead exports: 1");
    expect(md).toContain("`unused` in src/dead.js");
    expect(md).toContain("Unused dependencies (1): lodash");
    expect(md).toContain("### SonarQube");
    expect(md).toContain("Open issues: 1");
    expect(md).toContain("squid:S1234");
    expect(md).toContain("### WebPerf");
    expect(md).toContain("Mode: static hints only");
  });

  it("omits sections that have no data", () => {
    const md = formatDeterministicSummary({});
    expect(md).toContain("## Deterministic Findings");
    expect(md).not.toContain("### Project Stack");
    expect(md).not.toContain("### Basal Cost");
    expect(md).not.toContain("### SonarQube");
    expect(md).not.toContain("### WebPerf");
  });

  it("renders sonar 'not available' line gracefully when host is down", () => {
    const md = formatDeterministicSummary({ sonarFindings: { available: false, reason: "host unreachable" } });
    expect(md).toContain("Status: not available — host unreachable");
  });
});

describe("deterministicContextHasFindings", () => {
  it("returns true when there are dead exports", () => {
    expect(deterministicContextHasFindings(sampleDeterministicCtx)).toBe(true);
  });

  it("returns false when nothing notable was found", () => {
    expect(deterministicContextHasFindings({
      basalCost: { deadExports: [], unusedDependencies: { unused: [] } },
      sonarFindings: { available: true, total: 0, qualityGate: { status: "OK" } },
    })).toBe(false);
  });
});

describe("auditCommand two-phase flow (KJC-TSK-0364)", () => {
  it("--deterministic-only skips the LLM phase entirely (no executeWithDeterministic call)", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      deterministicOnly: true,
    });

    expect(executeWithDetMock).not.toHaveBeenCalled();
    expect(collectMock).toHaveBeenCalledOnce();
    expect(result.mode).toBe("deterministic-only");

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("## Deterministic Findings");
    expect(stdout).not.toContain("Codebase Health Report"); // no LLM section
  });

  it("--yes auto-confirms and proceeds to LLM (no prompt shown)", async () => {
    const promptFn = vi.fn().mockResolvedValue(false); // would say no, but --yes wins
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      yes: true, promptFn,
    });

    expect(promptFn).not.toHaveBeenCalled();
    expect(executeWithDetMock).toHaveBeenCalledOnce();

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("Codebase Health Report");
  });

  it("interactive YES → runs LLM phase", async () => {
    const promptFn = vi.fn().mockResolvedValue(true);
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      promptFn,
    });

    expect(promptFn).toHaveBeenCalledOnce();
    expect(executeWithDetMock).toHaveBeenCalledOnce();

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("## Deterministic Findings"); // shown before prompt
    expect(stdout).toContain("Codebase Health Report"); // LLM result
  });

  it("interactive NO → skips LLM and exits clean (deterministic-only mode)", async () => {
    const promptFn = vi.fn().mockResolvedValue(false);
    const { auditCommand } = await import("../../src/commands/audit.js");
    const result = await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      promptFn,
    });

    expect(promptFn).toHaveBeenCalledOnce();
    expect(executeWithDetMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("deterministic-only");

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    expect(stdout).toContain("## Deterministic Findings");
    expect(stdout).not.toContain("Codebase Health Report");
  });

  it("--json never prompts (would mangle script output) and runs full audit", async () => {
    const promptFn = vi.fn().mockResolvedValue(false);
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      json: true, promptFn,
    });

    expect(promptFn).not.toHaveBeenCalled();
    expect(executeWithDetMock).toHaveBeenCalledOnce();

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.summary.overallHealth).toBe("fair");
  });

  it("--json + --deterministic-only emits a deterministic-only JSON payload", async () => {
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      json: true, deterministicOnly: true,
    });

    const stdout = consoleSpy.mock.calls.map(c => c[0]).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.mode).toBe("deterministic-only");
    expect(parsed.deterministic.basalCost.totalLines).toBe(5000);
    expect(executeWithDetMock).not.toHaveBeenCalled();
  });

  it("deterministic-only writes to --report-file as markdown without LLM section", async () => {
    const target = path.join(tmpDir, "audit.md");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      reportFile: target, deterministicOnly: true,
    });

    const written = await fs.readFile(target, "utf8");
    expect(written).toContain("# Karajan Audit Report");
    expect(written).toContain("--deterministic-only");
    expect(written).toContain("## Deterministic Findings");
    expect(written).not.toContain("Codebase Health Report");
  });

  it("deterministic-only writes to --report-file as json with mode marker", async () => {
    const target = path.join(tmpDir, "audit.json");
    const { auditCommand } = await import("../../src/commands/audit.js");
    await auditCommand({
      task: "audit", config: makeConfig(), logger: noopLogger,
      reportFile: target, deterministicOnly: true, json: true,
    });

    const written = JSON.parse(await fs.readFile(target, "utf8"));
    expect(written.mode).toBe("deterministic-only");
    expect(written.deterministic.basalCost).toBeTruthy();
  });
});
