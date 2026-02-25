import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agents/index.js";
import { ClaudeAgent } from "../src/agents/claude-agent.js";
import { CodexAgent } from "../src/agents/codex-agent.js";
import { GeminiAgent } from "../src/agents/gemini-agent.js";
import { AiderAgent } from "../src/agents/aider-agent.js";

const config = { session: { max_iteration_minutes: 5 } };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("agents/index createAgent", () => {
  it("creates ClaudeAgent for 'claude'", () => {
    const agent = createAgent("claude", config, logger);
    expect(agent).toBeInstanceOf(ClaudeAgent);
  });

  it("creates CodexAgent for 'codex'", () => {
    const agent = createAgent("codex", config, logger);
    expect(agent).toBeInstanceOf(CodexAgent);
  });

  it("creates GeminiAgent for 'gemini'", () => {
    const agent = createAgent("gemini", config, logger);
    expect(agent).toBeInstanceOf(GeminiAgent);
  });

  it("creates AiderAgent for 'aider'", () => {
    const agent = createAgent("aider", config, logger);
    expect(agent).toBeInstanceOf(AiderAgent);
  });

  it("throws for unsupported agent name", () => {
    expect(() => createAgent("gpt5", config, logger)).toThrow("Unsupported agent: gpt5");
  });
});
