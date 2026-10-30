import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/mcp/run-kj.js", () => ({
  runKjCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: "done", stderr: "" })
}));

// KJC-BUG-0431: kj_run takes a per-project run lock; with no projectDir it would take
// the repo's real one, which another test (or a real run) may hold at that moment.
vi.mock("../../src/utils/run-log.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createRunLog: vi.fn(() => ({ owned: true, logText: vi.fn(), logEvent: vi.fn(), close: vi.fn() })),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      coder: "codex",
      reviewer: "claude",
      roles: { coder: { provider: "codex" }, reviewer: { provider: "claude" } },
      review_mode: "standard",
      development: { methodology: "tdd" },
      max_iterations: 5,
      reviewer_options: { fallback_reviewer: "codex", retries: 1 },
      coder_options: {},
      session: { max_iteration_minutes: 10, max_total_minutes: 120, max_planner_minutes: 60 },
      output: { log_level: "info" },
      pipeline: {},
      sonarqube: { enabled: false },
      git: {},
      failFast: { repeatThreshold: 2 },
      planning_game: { enabled: false }
    },
    path: "/tmp/kj.config.yml",
    exists: true
  }),
  applyRunOverrides: vi.fn((config, flags) => config),
  validateConfig: vi.fn((config) => config),
  resolveRole: vi.fn((config, role) => ({
    provider: config?.roles?.[role]?.provider || "codex",
    model: null
  }))
}));

vi.mock("../../src/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    onLog: vi.fn(), setContext: vi.fn()
  }))
}));

vi.mock("../../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../../src/mcp/progress.js", () => ({
  buildProgressHandler: vi.fn(() => vi.fn()),
  buildProgressNotifier: vi.fn(() => null),
  buildPipelineTracker: vi.fn(() => ({ stages: [] })),
  sendTrackerLog: vi.fn()
}));

vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn().mockResolvedValue({ ok: true, output: "done", exitCode: 0 }),
    reviewTask: vi.fn().mockResolvedValue({ ok: true, output: '{"approved":true}', exitCode: 0 })
  }))
}));

vi.mock("../../src/prompts/planner.js", () => ({
  buildPlannerPrompt: vi.fn(() => "planner prompt")
}));

vi.mock("../../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn(() => "coder prompt"),
  buildCoderPromptLayout: async () => ({ stable: "coder prompt", volatile: "" })
}));

vi.mock("../../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn(() => "reviewer prompt")
}));

vi.mock("../../src/review/parser.js", () => ({
  parseMaybeJsonString: vi.fn((s) => {
    try { return JSON.parse(s); } catch { return null; }
  }),
  agentAnswerText: vi.fn((s) => s)
}));

vi.mock("../../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content"),
  setProjectDir: vi.fn()
}));

vi.mock("../../src/review/profiles.js", () => ({
  resolveReviewProfile: vi.fn().mockResolvedValue({ rules: "review rules" })
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: vi.fn().mockResolvedValue("coder rules content"), access: vi.fn().mockResolvedValue(undefined) },
  readFile: vi.fn().mockResolvedValue("coder rules content"),
  access: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../src/utils/git.js", () => ({
  currentBranch: vi.fn().mockResolvedValue("feat/my-feature")
}));

vi.mock("../../src/bootstrap.js", () => ({
  ensureBootstrap: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../src/roles/researcher-role.js", () => ({
  ResearcherRole: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(),
    run: vi.fn().mockResolvedValue({ ok: true, result: { files: ["a.js"] }, summary: "research done" })
  }))
}));

vi.mock("../../src/roles/architect-role.js", () => ({
  ArchitectRole: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(),
    run: vi.fn().mockResolvedValue({ ok: true, result: { layers: ["service"] }, summary: "architecture done" })
  }))
}));

vi.mock("../../src/plan/plan-store.js", () => ({
  savePlan: vi.fn().mockResolvedValue("plan-20260331-test")
}));


const {
  asObject,
  responseText,
  failPayload,
  classifyError,
  enrichedFailPayload,
  assertNotOnBaseBranch,
  buildAskQuestion,
  handleToolCall,
  handleCodeDirect
} = await import("../../src/mcp/server-handlers.js");

const { runKjCommand } = await import("../../src/mcp/run-kj.js");
const { assertAgentsAvailable } = await import("../../src/agents/availability.js");
const { createAgent } = await import("../../src/agents/index.js");
const { sendTrackerLog } = await import("../../src/mcp/progress.js");
const { currentBranch } = await import("../../src/utils/git.js");
const { ackPreflight, resetPreflight } = await import("../../src/mcp/preflight.js");

const mockServer = {
  sendLoggingMessage: vi.fn(),
  elicitInput: vi.fn(),
  getClientCapabilities: vi.fn(() => ({ elicitation: true }))
};

describe("mcp/server-handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreflight();
  });

  // --- asObject ---

  describe("asObject", () => {
    it("returns object as-is", () => {
      const obj = { foo: 1 };
      expect(asObject(obj)).toBe(obj);
    });

    it("returns empty object for null", () => {
      expect(asObject(null)).toEqual({});
    });

    it("returns empty object for undefined", () => {
      expect(asObject(undefined)).toEqual({});
    });

    it("returns empty object for string", () => {
      expect(asObject("hello")).toEqual({});
    });

    it("returns empty object for number", () => {
      expect(asObject(42)).toEqual({});
    });
  });

  // --- responseText ---

  describe("responseText", () => {
    it("wraps payload as MCP text content", () => {
      const result = responseText({ ok: true, data: "test" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toBe("test");
    });
  });

  // --- failPayload ---

  describe("failPayload", () => {
    it("creates error payload with ok=false", () => {
      const result = failPayload("Something went wrong");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Something went wrong");
    });

    it("merges additional details", () => {
      const result = failPayload("Error", { code: 42, hint: "check config" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(42);
      expect(result.hint).toBe("check config");
    });
  });

  // --- classifyError ---

  describe("classifyError", () => {
    it("classifies sonar connection errors", () => {
      const result = classifyError(new Error("Sonar ECONNREFUSED"));
      expect(result.category).toBe("sonar_unavailable");
      expect(result.suggestion).toContain("SonarQube");
    });

    it("classifies auth errors", () => {
      const result = classifyError(new Error("401 Unauthorized"));
      expect(result.category).toBe("auth_error");
    });

    it("classifies config errors", () => {
      const result = classifyError(new Error("Config file not found"));
      expect(result.category).toBe("config_error");
    });

    it("classifies timeout errors", () => {
      const result = classifyError(new Error("Operation timed out"));
      expect(result.category).toBe("timeout");
    });

    it("classifies stalled agent errors", () => {
      const result = classifyError(new Error("Command killed after 1200000ms without output"));
      expect(result.category).toBe("agent_stall");
      expect(result.suggestion).toContain("kj_status");
    });

    it("classifies git errors", () => {
      const result = classifyError(new Error("not a git repository"));
      expect(result.category).toBe("git_error");
    });

    it("returns unknown for unrecognized errors", () => {
      const result = classifyError(new Error("Something random happened"));
      expect(result.category).toBe("unknown");
      expect(result.suggestion).toBeNull();
    });

    it("handles string errors", () => {
      const result = classifyError("Sonar not running");
      expect(result.category).toBe("sonar_unavailable");
    });
  });

  // --- assertNotOnBaseBranch ---

  describe("assertNotOnBaseBranch", () => {
    it("throws when on the base branch (main)", async () => {
      currentBranch.mockResolvedValueOnce("main");
      await expect(assertNotOnBaseBranch({ base_branch: "main" }))
        .rejects.toThrow(/You are on the base branch 'main'/);
    });

    it("throws when on a custom base branch", async () => {
      currentBranch.mockResolvedValueOnce("develop");
      await expect(assertNotOnBaseBranch({ base_branch: "develop" }))
        .rejects.toThrow(/You are on the base branch 'develop'/);
    });

    it("does not throw when on a feature branch", async () => {
      currentBranch.mockResolvedValueOnce("feat/my-feature");
      await expect(assertNotOnBaseBranch({ base_branch: "main" })).resolves.toBeUndefined();
    });

    it("does not throw when currentBranch fails (not a git repo)", async () => {
      currentBranch.mockRejectedValueOnce(new Error("not a git repo"));
      await expect(assertNotOnBaseBranch({ base_branch: "main" })).resolves.toBeUndefined();
    });

    it("defaults to main when config has no base_branch", async () => {
      currentBranch.mockResolvedValueOnce("main");
      await expect(assertNotOnBaseBranch({}))
        .rejects.toThrow(/You are on the base branch 'main'/);
    });
  });

  // --- classifyError: branch_error ---

  describe("classifyError branch_error", () => {
    it("classifies base branch errors", () => {
      const result = classifyError(new Error("You are on the base branch 'main'"));
      expect(result.category).toBe("branch_error");
      expect(result.suggestion).toContain("feature branch");
    });
  });

  // --- enrichedFailPayload ---

  describe("enrichedFailPayload", () => {
    it("creates enriched payload with classification", () => {
      const result = enrichedFailPayload(new Error("Sonar ECONNREFUSED"), "kj_scan");
      expect(result.ok).toBe(false);
      expect(result.tool).toBe("kj_scan");
      expect(result.category).toBe("sonar_unavailable");
      expect(result.suggestion).toBeTruthy();
    });

    it("handles unknown errors without suggestion", () => {
      const result = enrichedFailPayload(new Error("Random error"), "kj_run");
      expect(result.ok).toBe(false);
      expect(result.category).toBe("unknown");
      expect(result.suggestion).toBeUndefined();
    });
  });

  // --- buildAskQuestion ---

  describe("buildAskQuestion", () => {
    it("returns answer from elicitInput on accept", async () => {
      mockServer.elicitInput.mockResolvedValue({
        action: "accept",
        content: { answer: "Yes, proceed" }
      });

      const askQuestion = buildAskQuestion(mockServer);
      const answer = await askQuestion("Should we continue?");

      expect(answer).toBe("Yes, proceed");
      expect(mockServer.elicitInput).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Should we continue?" })
      );
    });

    it("returns null when user rejects", async () => {
      mockServer.elicitInput.mockResolvedValue({ action: "reject" });

      const askQuestion = buildAskQuestion(mockServer);
      const answer = await askQuestion("Question?");

      expect(answer).toBeNull();
    });

    it("returns null when elicitInput throws", async () => {
      mockServer.elicitInput.mockRejectedValue(new Error("Not supported"));

      const askQuestion = buildAskQuestion(mockServer);
      const answer = await askQuestion("Question?");

      expect(answer).toBeNull();
    });

    it("returns null when content.answer is missing", async () => {
      mockServer.elicitInput.mockResolvedValue({ action: "accept", content: {} });

      const askQuestion = buildAskQuestion(mockServer);
      const answer = await askQuestion("Question?");

      expect(answer).toBeNull();
    });
  });

  // --- handleToolCall dispatcher ---

  describe("handleToolCall", () => {
    it("routes kj_init to runKjCommand", async () => {
      await handleToolCall("kj_init", {}, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "init", options: {} });
    });

    it("routes kj_doctor to runKjCommand", async () => {
      await handleToolCall("kj_doctor", {}, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "doctor", commandArgs: [], options: {} });
    });

    it("forwards kj_doctor flags as CLI args", async () => {
      await handleToolCall("kj_doctor", { checkOnly: true, yes: true, json: true, verbose: true }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "doctor",
        commandArgs: ["--check-only", "--yes", "--json", "--verbose"],
        options: { checkOnly: true, yes: true, json: true, verbose: true },
      });
    });

    it("routes kj_config with json flag", async () => {
      await handleToolCall("kj_config", { json: true }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "config",
        commandArgs: ["--json"],
        options: { json: true }
      });
    });

    it("routes kj_config without json flag", async () => {
      await handleToolCall("kj_config", {}, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "config",
        commandArgs: [],
        options: {}
      });
    });

    it("routes kj_scan to runKjCommand", async () => {
      await handleToolCall("kj_scan", {}, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "scan", options: {} });
    });

    it("routes kj_report with list flag", async () => {
      await handleToolCall("kj_report", { list: true }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "report",
        commandArgs: ["--list"],
        options: { list: true }
      });
    });

    it("routes kj_report with sessionId and json format", async () => {
      await handleToolCall("kj_report", { sessionId: "s_123", format: "json" }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "report",
        commandArgs: ["--session-id", "s_123", "--format", "json"],
        options: { sessionId: "s_123", format: "json" }
      });
    });

    it("routes kj_code in-process (not via subprocess)", async () => {
      ackPreflight();
      const result = await handleToolCall("kj_code", { task: "Fix bug" }, mockServer, {});
      expect(result.ok).toBe(true);
      expect(result.output).toBe("done");
      expect(createAgent).toHaveBeenCalled();
      expect(runKjCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "code" })
      );
    });

    // --- Required field validation ---

    it("returns error when kj_code has no task", async () => {
      const result = await handleToolCall("kj_code", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("task");
    });

    it("returns error for unknown tool", async () => {
      const result = await handleToolCall("kj_nonexistent", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    // --- kjHome (KJC-BUG-0176, #1722) ---

    it("kj_code resolves the home from kjHome for the bootstrap gate, without touching the env", async () => {
      const { ensureBootstrap } = await import("../../src/bootstrap.js");
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      const seen = [];
      vi.mocked(ensureBootstrap).mockImplementationOnce(async () => { seen.push(getKarajanHome()); });
      const envBefore = process.env.KARAJAN_HOME;

      const result = await handleToolCall(
        "kj_code", { task: "Fix auth", kjHome: "/tmp/other-home" }, mockServer, {}
      );

      expect(result.ok).toBe(true);
      expect(seen).toEqual([path.resolve("/tmp/other-home")]);
      expect(process.env.KARAJAN_HOME).toBe(envBefore);
      expect(getKarajanHome()).not.toBe(path.resolve("/tmp/other-home"));
    });

    // --- Preflight gate ---

    it("kj_code auto-acknowledges preflight when not acked", async () => {
      const result = await handleToolCall("kj_code", { task: "Do stuff" }, mockServer, {});
      // With auto-ack, kj_code proceeds to execution instead of returning preflightRequired
      expect(result.ok).toBe(true);
    });

    it("kj_preflight acks and returns config", async () => {
      const result = await handleToolCall("kj_preflight", { humanResponse: "ok" }, mockServer, {});
      expect(result.ok).toBe(true);
      expect(result.message).toContain("Preflight acknowledged");
    });

    it("kj_preflight parses natural language overrides", async () => {
      const result = await handleToolCall("kj_preflight", { humanResponse: "use gemini as coder" }, mockServer, {});
      expect(result.ok).toBe(true);
      expect(result.overrides.coder).toBe("gemini");
    });

    // --- Branch validation ---

    it("kj_code rejects when on base branch", async () => {
      ackPreflight();
      currentBranch.mockResolvedValueOnce("main");
      await expect(handleToolCall("kj_code", { task: "Do stuff" }, mockServer, {}))
        .rejects.toThrow(/You are on the base branch/);
    });

    // --- Handles null/undefined args gracefully ---

    it("handles null args via asObject", async () => {
      await handleToolCall("kj_init", null, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "init", options: {} });
    });

    it("handles undefined args", async () => {
      await handleToolCall("kj_doctor", undefined, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "doctor", commandArgs: [], options: {} });
    });
  });

  // --- Single-agent tracker logging ---

  describe("single-agent tracker logging", () => {
    it("kj_code sends tracker start and done logs", async () => {
      await handleCodeDirect({ task: "Fix bug" }, mockServer, {});

      expect(sendTrackerLog).toHaveBeenCalledWith(mockServer, "coder", "running", expect.any(String));
      expect(sendTrackerLog).toHaveBeenCalledWith(mockServer, "coder", "done");
    });

  });
});
