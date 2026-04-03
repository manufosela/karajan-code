import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock heavy dependencies ─────────────────────────────────────

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn(() => ({ provider: "claude" })),
  loadConfig: vi.fn(() => ({ config: { output: { log_level: "silent" }, base_branch: "main" } })),
  applyRunOverrides: vi.fn((c, o) => ({ ...c, ...o })),
  validateConfig: vi.fn()
}));

vi.mock("../src/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
  }))
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({ ok: true, output: "done", exitCode: 0 })),
    reviewTask: vi.fn(async () => ({ ok: true, output: "lgtm", exitCode: 0 }))
  }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  buildPlannerPrompt: vi.fn(() => "plan prompt")
}));

vi.mock("../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn(async () => "code prompt")
}));

vi.mock("../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn(async () => "review prompt")
}));

vi.mock("../src/review/parser.js", () => ({
  parseMaybeJsonString: vi.fn((s) => null)
}));

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn(async () => "main"),
  generateDiff: vi.fn(async () => "diff content"),
  setProjectDir: vi.fn()
}));

vi.mock("../src/review/profiles.js", () => ({
  resolveReviewProfile: vi.fn(async () => ({ rules: "default rules" }))
}));

vi.mock("../src/utils/run-log.js", () => ({
  createRunLog: vi.fn(() => ({
    logText: vi.fn(),
    logEvent: vi.fn(),
    close: vi.fn()
  }))
}));

vi.mock("../src/utils/stall-detector.js", () => ({
  createStallDetector: vi.fn(() => ({
    onOutput: vi.fn(),
    stop: vi.fn(),
    stats: vi.fn(() => ({ lineCount: 10, bytesReceived: 500, elapsedMs: 1000 }))
  }))
}));

vi.mock("../src/mcp/progress.js", () => ({
  sendTrackerLog: vi.fn(),
  buildProgressNotifier: vi.fn(() => null)
}));

vi.mock("../src/mcp/direct-role-runner.js", () => ({
  runDirectRole: vi.fn(async () => ({ ok: true, output: "role result" }))
}));

vi.mock("../src/mcp/preflight.js", () => ({
  isPreflightAcked: vi.fn(() => true),
  ackPreflight: vi.fn(),
  getSessionOverrides: vi.fn(() => ({}))
}));

vi.mock("../src/bootstrap.js", () => ({
  ensureBootstrap: vi.fn()
}));

vi.mock("../src/utils/git.js", () => ({
  currentBranch: vi.fn(async () => "feat/test-branch")
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: vi.fn(async () => "coder rules"), access: vi.fn(async () => { throw new Error("ENOENT"); }) }
}));

import { EventEmitter } from "node:events";

// Mock resolveProjectDir and friends in shared-helpers
vi.mock("../src/mcp/shared-helpers.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    resolveProjectDir: vi.fn(async () => "/tmp/test-project"),
    assertNotOnBaseBranch: vi.fn(async () => undefined),
    buildConfig: vi.fn(async () => ({
      output: { log_level: "silent" },
      base_branch: "main",
      development: { methodology: "tdd" },
      review_mode: "standard",
      coder_rules: null
    })),
    buildDirectEmitter: vi.fn(() => new EventEmitter()),
    failPayload: (message, details = {}) => ({ ok: false, error: message, ...details })
  };
});

const {
  handleCode, handleReview, handlePlan,
  handleDiscover, handleTriage, handleResearcher,
  handleArchitect, handleAudit
} = await import("../src/mcp/handlers/direct-handlers.js");

const { runDirectRole } = await import("../src/mcp/direct-role-runner.js");
const { isPreflightAcked, ackPreflight } = await import("../src/mcp/preflight.js");

// ── Helpers ─────────────────────────────────────────────────────

const mockServer = {
  listRoots: vi.fn(async () => ({ roots: [{ uri: "file:///tmp/test-project" }] })),
  sendLoggingMessage: vi.fn(),
  getClientCapabilities: vi.fn(() => ({}))
};

const mockExtra = {};

describe("direct-handlers — public handler wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPreflightAcked).mockReturnValue(true);
  });

  // ── Parameter validation (missing task) ───────────────────────

  describe("missing task validation", () => {
    const handlersRequiringTask = [
      ["handleCode", handleCode],
      ["handleReview", handleReview],
      ["handlePlan", handlePlan],
      ["handleDiscover", handleDiscover],
      ["handleTriage", handleTriage],
      ["handleResearcher", handleResearcher],
      ["handleArchitect", handleArchitect]
    ];

    it.each(handlersRequiringTask)(
      "%s returns error when task is missing",
      async (_name, handler) => {
        const result = await handler({}, mockServer, mockExtra);

        expect(result).toEqual(expect.objectContaining({
          ok: false,
          error: "Missing required field: task"
        }));
      }
    );

    it("handleAudit does NOT require task (defaults to full codebase)", async () => {
      // handleAudit should not return a missing-task error
      const result = await handleAudit({}, mockServer, mockExtra);

      expect(result).not.toEqual(expect.objectContaining({
        ok: false,
        error: expect.stringContaining("Missing required field")
      }));
    });
  });

  // ── handleDiscover mode validation ────────────────────────────

  describe("handleDiscover mode validation", () => {
    it("rejects invalid mode", async () => {
      const result = await handleDiscover({ task: "test", mode: "invalid" }, mockServer, mockExtra);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid mode "invalid"');
      expect(result.error).toContain("gaps");
    });

    it.each(["gaps", "momtest", "wendel", "classify", "jtbd"])(
      "accepts valid mode: %s",
      async (mode) => {
        const result = await handleDiscover({ task: "test", mode }, mockServer, mockExtra);
        // Should not be a validation error
        expect(result).not.toEqual(expect.objectContaining({
          ok: false,
          error: expect.stringContaining("Invalid mode")
        }));
      }
    );
  });

  // ── Preflight auto-ack ────────────────────────────────────────

  describe("handleCode preflight auto-acknowledge", () => {
    it("auto-acknowledges preflight if not yet acked", async () => {
      vi.mocked(isPreflightAcked).mockReturnValue(false);

      await handleCode({ task: "implement feature" }, mockServer, mockExtra);

      expect(ackPreflight).toHaveBeenCalledWith({});
    });

    it("does not re-ack if already acknowledged", async () => {
      vi.mocked(isPreflightAcked).mockReturnValue(true);

      await handleCode({ task: "implement feature" }, mockServer, mockExtra);

      expect(ackPreflight).not.toHaveBeenCalled();
    });
  });

  // ── Routing to runDirectRole ──────────────────────────────────

  describe("routing to runDirectRole", () => {
    it("handleDiscover delegates to runDirectRole with roleName=discover", async () => {
      await handleDiscover({ task: "find gaps" }, mockServer, mockExtra);

      expect(runDirectRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: "discover" })
      );
    });

    it("handleTriage delegates to runDirectRole with roleName=triage", async () => {
      await handleTriage({ task: "classify this" }, mockServer, mockExtra);

      expect(runDirectRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: "triage" })
      );
    });

    it("handleResearcher delegates to runDirectRole with roleName=researcher", async () => {
      await handleResearcher({ task: "research this" }, mockServer, mockExtra);

      expect(runDirectRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: "researcher" })
      );
    });

    it("handleArchitect delegates to runDirectRole with roleName=architect", async () => {
      await handleArchitect({ task: "design this" }, mockServer, mockExtra);

      expect(runDirectRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: "architect" })
      );
    });
  });

  // ── handleDiscover PG context enrichment ──────────────────────

  describe("handleDiscover PG context enrichment", () => {
    it("enriches context with PG card when pgTask and pgProject are provided", async () => {
      await handleDiscover(
        { task: "gaps", pgTask: "TSK-001", pgProject: "KJC" },
        mockServer,
        mockExtra
      );

      expect(runDirectRole).toHaveBeenCalledWith(
        expect.objectContaining({
          runInput: expect.objectContaining({
            task: "gaps",
            context: expect.stringContaining("TSK-001")
          })
        })
      );
    });
  });

  // ── handleAudit response compaction ───────────────────────────

  describe("handleAudit response compaction", () => {
    it("returns compact summary when result has ok + summary", async () => {
      vi.mocked(runDirectRole).mockResolvedValueOnce({
        ok: true,
        summary: { overallHealth: "B", totalFindings: 5, critical: 0, high: 1 },
        topRecommendations: [
          { priority: 1, dimension: "security", action: "fix XSS", impact: "high" }
        ],
        textSummary: "Overall health: B"
      });

      const result = await handleAudit({ task: "audit" }, mockServer, mockExtra);

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.overallHealth).toBe("B");
      expect(parsed.topRecommendations).toHaveLength(1);
    });

    it("passes through raw result when no summary", async () => {
      const rawResult = { ok: true, output: "raw audit output" };
      vi.mocked(runDirectRole).mockResolvedValueOnce(rawResult);

      const result = await handleAudit({}, mockServer, mockExtra);

      expect(result).toEqual(rawResult);
    });
  });
});
