import { describe, it, expect, afterEach } from "vitest";
import { detectHostAgent, isHostAgent } from "../src/utils/agent-detect.js";

describe("detectHostAgent", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("detects Claude as host", () => {
    process.env.CLAUDECODE = "1";
    expect(detectHostAgent()).toBe("claude");
  });

  it("detects Codex as host", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    process.env.CODEX_CLI = "1";
    expect(detectHostAgent()).toBe("codex");
  });

  it("returns null when no host detected", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    delete process.env.CODEX_CLI;
    delete process.env.CODEX;
    delete process.env.GEMINI_CLI;
    delete process.env.OPENCODE;
    expect(detectHostAgent()).toBeNull();
  });
});

describe("isHostAgent", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns true when provider matches host", () => {
    process.env.CLAUDECODE = "1";
    expect(isHostAgent("claude")).toBe(true);
  });

  it("returns false when provider differs from host", () => {
    process.env.CLAUDECODE = "1";
    expect(isHostAgent("codex")).toBe(false);
  });

  it("returns false when not inside any host", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    expect(isHostAgent("claude")).toBe(false);
  });
});
