import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgent, registerAgent, getAvailableAgents } from "../../src/agents/index.js";
import { ClaudeAgent } from "../../src/agents/claude-agent.js";
import { CodexAgent } from "../../src/agents/codex-agent.js";
import { GeminiAgent } from "../../src/agents/gemini-agent.js";
import { AiderAgent } from "../../src/agents/aider-agent.js";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { createNoopLogger } from "../_fixtures/loggers.js";
import { readUsage } from "../../src/usage/record.js";

const config = { session: { max_iteration_minutes: 5 } };
const logger = createNoopLogger();

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

describe("agents/index registerAgent", () => {
  it("registers a custom agent and creates instances via createAgent", () => {
    class CustomAgent extends BaseAgent {}
    registerAgent("custom", CustomAgent, { bin: "custom-cli" });

    const agent = createAgent("custom", config, logger);
    expect(agent).toBeInstanceOf(CustomAgent);
    expect(agent.name).toBe("custom");
  });

  it("records each call of an agent it creates in the usage record (HU-4592)", async () => {
    class UsageAgent extends BaseAgent {
      async runTask() { return { ok: true, exitCode: 0, cost_usd: 0.5 }; }
    }
    registerAgent("usage-probe", UsageAgent);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-usage-index-"));
    vi.stubEnv("KARAJAN_HOME", home);
    try {
      await createAgent("usage-probe", config, logger).runTask({ role: "planner" });
      const calls = readUsage(new Date().toISOString().slice(0, 7), { home });
      expect(calls).toEqual([expect.objectContaining({ provider: "usage-probe", role: "planner", costUsd: 0.5, exitCode: 0 })]);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("throws when name is empty", () => {
    expect(() => registerAgent("", BaseAgent)).toThrow("Agent name must be a non-empty string");
  });

  it("throws when name is not a string", () => {
    expect(() => registerAgent(null, BaseAgent)).toThrow("Agent name must be a non-empty string");
  });
});

describe("agents/index getAvailableAgents", () => {
  it("returns all registered agents with their metadata", () => {
    const agents = getAvailableAgents();
    const names = agents.map((a) => a.name);

    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("gemini");
    expect(names).toContain("aider");
  });

  it("includes AgentClass in each entry", () => {
    const agents = getAvailableAgents();
    const claude = agents.find((a) => a.name === "claude");
    expect(claude.AgentClass).toBe(ClaudeAgent);
  });

  it("includes meta fields in each entry", () => {
    const agents = getAvailableAgents();
    const custom = agents.find((a) => a.name === "custom");
    expect(custom.bin).toBe("custom-cli");
  });
});
