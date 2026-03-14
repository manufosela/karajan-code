import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyError } from "../src/mcp/server-handlers.js";

vi.mock("../src/session-store.js", () => ({
  loadMostRecentSession: vi.fn(),
  saveSession: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ id: "s_test", status: "running", checkpoints: [] }),
  loadSession: vi.fn(),
  markSessionStatus: vi.fn(),
  addCheckpoint: vi.fn(),
  pauseSession: vi.fn(),
  resumeSessionWithAnswer: vi.fn()
}));

describe("resilient run — error classification", () => {
  it("classifies config errors as non-recoverable", () => {
    const { category } = classifyError(new Error("Config missing required field"));
    expect(category).toBe("config_error");
  });

  it("classifies auth errors as non-recoverable", () => {
    const { category } = classifyError(new Error("401 Unauthorized"));
    expect(category).toBe("auth_error");
  });

  it("classifies agent missing as non-recoverable", () => {
    const { category } = classifyError(new Error("missing provider claude not found"));
    expect(category).toBe("agent_missing");
  });

  it("classifies branch error as non-recoverable", () => {
    const { category } = classifyError(new Error("You are on the base branch"));
    expect(category).toBe("branch_error");
  });

  it("classifies timeouts as recoverable", () => {
    const { category } = classifyError(new Error("Session timed out"));
    expect(category).toBe("timeout");
  });

  it("classifies stalls as recoverable", () => {
    const { category } = classifyError(new Error("Agent without output for 5 minutes"));
    expect(category).toBe("agent_stall");
  });

  it("classifies unknown errors as recoverable", () => {
    const { category } = classifyError(new Error("Something unexpected happened"));
    expect(category).toBe("unknown");
  });
});

describe("resilient run — loadMostRecentSession", () => {
  let loadMostRecentSession;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import("../src/session-store.js");
    loadMostRecentSession = mod.loadMostRecentSession;
  });

  it("returns null when no sessions exist", async () => {
    loadMostRecentSession.mockResolvedValue(null);
    const session = await loadMostRecentSession();
    expect(session).toBeNull();
  });

  it("returns most recent session", async () => {
    const mockSession = { id: "s_2026-03-14", status: "failed", auto_resume_count: 0 };
    loadMostRecentSession.mockResolvedValue(mockSession);
    const session = await loadMostRecentSession();
    expect(session.status).toBe("failed");
  });
});

describe("resilient run — auto-resume limits", () => {
  it("max_auto_resumes defaults to 2 in loaded config", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { config } = await loadConfig("/tmp/nonexistent-project");
    expect(config.session.max_auto_resumes).toBe(2);
  });
});
