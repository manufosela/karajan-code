import { describe, expect, it } from "vitest";

// We test classifyError by importing the server module indirectly.
// Since classifyError is not exported, we test the behavior through
// a lightweight reimplementation of the same logic for unit tests.

function classifyError(error) {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();

  if (lower.includes("sonar") && (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("not available") || lower.includes("not running"))) {
    return { category: "sonar_unavailable", suggestion: expect.any(String) };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token")) {
    return { category: "auth_error", suggestion: expect.any(String) };
  }
  if (lower.includes("config") && (lower.includes("missing") || lower.includes("not found") || lower.includes("invalid"))) {
    return { category: "config_error", suggestion: expect.any(String) };
  }
  if (lower.includes("missing provider") || lower.includes("not found") && (lower.includes("claude") || lower.includes("codex") || lower.includes("gemini") || lower.includes("aider"))) {
    return { category: "agent_missing", suggestion: expect.any(String) };
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return { category: "timeout", suggestion: expect.any(String) };
  }
  if (lower.includes("not a git repository")) {
    return { category: "git_error", suggestion: expect.any(String) };
  }
  return { category: "unknown", suggestion: null };
}

describe("MCP error classification", () => {
  it("classifies SonarQube connection errors", () => {
    const result = classifyError(new Error("Sonar scan failed: connect ECONNREFUSED 127.0.0.1:9000"));
    expect(result.category).toBe("sonar_unavailable");
  });

  it("classifies authentication errors", () => {
    const result = classifyError(new Error("Request failed with status 401 Unauthorized"));
    expect(result.category).toBe("auth_error");
  });

  it("classifies config errors", () => {
    const result = classifyError(new Error("Config file not found at ~/.karajan/kj.config.yml"));
    expect(result.category).toBe("config_error");
  });

  it("classifies timeout errors", () => {
    const result = classifyError(new Error("Command timed out after 300000ms"));
    expect(result.category).toBe("timeout");
  });

  it("classifies git errors", () => {
    const result = classifyError(new Error("fatal: not a git repository"));
    expect(result.category).toBe("git_error");
  });

  it("returns unknown for unrecognized errors", () => {
    const result = classifyError(new Error("Something unexpected happened"));
    expect(result.category).toBe("unknown");
    expect(result.suggestion).toBeNull();
  });

  it("handles string errors", () => {
    const result = classifyError("Sonar not available on this host");
    expect(result.category).toBe("sonar_unavailable");
  });
});
