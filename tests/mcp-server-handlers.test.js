import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/mcp/run-kj.js", () => ({
  runKjCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: "done", stderr: "" })
}));

vi.mock("../src/orchestrator.js", () => ({
  runFlow: vi.fn().mockResolvedValue({ approved: true, sessionId: "s_test" }),
  resumeFlow: vi.fn().mockResolvedValue({ approved: true, sessionId: "s_test" })
}));

vi.mock("../src/config.js", () => ({
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
      session: { max_iteration_minutes: 10, max_total_minutes: 120 },
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

vi.mock("../src/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    onLog: vi.fn(), setContext: vi.fn()
  }))
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/mcp/progress.js", () => ({
  buildProgressHandler: vi.fn(() => vi.fn()),
  buildProgressNotifier: vi.fn(() => null)
}));

vi.mock("../src/mcp/tool-arg-normalizers.js", () => ({
  normalizePlanArgs: vi.fn((a) => a)
}));

const {
  asObject,
  responseText,
  failPayload,
  classifyError,
  enrichedFailPayload,
  buildAskQuestion,
  handleToolCall
} = await import("../src/mcp/server-handlers.js");

const { runKjCommand } = await import("../src/mcp/run-kj.js");
const { runFlow, resumeFlow } = await import("../src/orchestrator.js");
const { assertAgentsAvailable } = await import("../src/agents/availability.js");

const mockServer = {
  sendLoggingMessage: vi.fn(),
  elicitInput: vi.fn()
};

describe("mcp/server-handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(runKjCommand).toHaveBeenCalledWith({ command: "doctor", options: {} });
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

    it("routes kj_code with task arg", async () => {
      await handleToolCall("kj_code", { task: "Fix bug" }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "code",
        commandArgs: ["Fix bug"],
        options: { task: "Fix bug" }
      });
    });

    it("routes kj_review with task arg", async () => {
      await handleToolCall("kj_review", { task: "Review auth" }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "review",
        commandArgs: ["Review auth"],
        options: { task: "Review auth" }
      });
    });

    it("routes kj_plan with task and normalizes args", async () => {
      await handleToolCall("kj_plan", { task: "Plan feature" }, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({
        command: "plan",
        commandArgs: ["Plan feature"],
        options: expect.objectContaining({ task: "Plan feature" })
      });
    });

    // --- Required field validation ---

    it("returns error when kj_run has no task", async () => {
      const result = await handleToolCall("kj_run", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("task");
    });

    it("returns error when kj_code has no task", async () => {
      const result = await handleToolCall("kj_code", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("task");
    });

    it("returns error when kj_review has no task", async () => {
      const result = await handleToolCall("kj_review", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("task");
    });

    it("returns error when kj_plan has no task", async () => {
      const result = await handleToolCall("kj_plan", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("task");
    });

    it("returns error when kj_resume has no sessionId", async () => {
      const result = await handleToolCall("kj_resume", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("sessionId");
    });

    it("returns error for unknown tool", async () => {
      const result = await handleToolCall("kj_nonexistent", {}, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    // --- Direct handlers (kj_run, kj_resume) ---

    it("kj_run calls runFlow and returns result", async () => {
      const result = await handleToolCall("kj_run", { task: "Implement feature" }, mockServer, {});
      expect(assertAgentsAvailable).toHaveBeenCalled();
      expect(runFlow).toHaveBeenCalledWith(
        expect.objectContaining({ task: "Implement feature" })
      );
      expect(result.ok).toBe(true);
      expect(result.approved).toBe(true);
    });

    it("kj_resume calls resumeFlow with sessionId", async () => {
      const result = await handleToolCall("kj_resume", { sessionId: "s_test-123", answer: "proceed" }, mockServer, {});
      expect(resumeFlow).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s_test-123", answer: "proceed" })
      );
      expect(result.ok).toBe(true);
    });

    it("kj_run returns ok=false when result is paused", async () => {
      runFlow.mockResolvedValueOnce({ paused: true, sessionId: "s_paused", question: "How?" });
      const result = await handleToolCall("kj_run", { task: "Task" }, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.paused).toBe(true);
    });

    it("kj_run returns ok=false when not approved", async () => {
      runFlow.mockResolvedValueOnce({ approved: false, sessionId: "s_fail", reason: "stalled" });
      const result = await handleToolCall("kj_run", { task: "Task" }, mockServer, {});
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("stalled");
    });

    // --- Handles null/undefined args gracefully ---

    it("handles null args via asObject", async () => {
      await handleToolCall("kj_init", null, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "init", options: {} });
    });

    it("handles undefined args", async () => {
      await handleToolCall("kj_doctor", undefined, mockServer, {});
      expect(runKjCommand).toHaveBeenCalledWith({ command: "doctor", options: {} });
    });
  });
});
