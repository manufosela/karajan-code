import { describe, expect, it, vi } from "vitest";
import { createAgent, getAvailableAgents, getAgentMeta, registerAgent } from "../../src/agents/index.js";
import { ClaudeAgent } from "../../src/agents/claude-agent.js";
import { CodexAgent } from "../../src/agents/codex-agent.js";
import { GeminiAgent } from "../../src/agents/gemini-agent.js";
import { AiderAgent } from "../../src/agents/aider-agent.js";
import { OpenCodeAgent } from "../../src/agents/opencode-agent.js";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { createNoopLogger } from "../_fixtures/loggers.js";

const config = { roles: {}, coder_options: {}, reviewer_options: {} };
const logger = createNoopLogger();

describe("createAgent factory", () => {
  // merged-from: 5 per-agent instance tests collapsed into a single it.each
  // covering claude/codex/gemini/aider/opencode → expected concrete class.
  describe("creates correct agent instances", () => {
    it.each([
      ["claude",   ClaudeAgent],
      ["codex",    CodexAgent],
      ["gemini",   GeminiAgent],
      ["aider",    AiderAgent],
      ["opencode", OpenCodeAgent]
    ])("createAgent('%s') returns the matching concrete agent + extends BaseAgent", (name, AgentClass) => {
      const agent = createAgent(name, config, logger);
      expect(agent).toBeInstanceOf(AgentClass);
      expect(agent).toBeInstanceOf(BaseAgent);
    });
  });

  // merged-from: 3 unsupported-name tests (unknown / empty / arbitrary string)
  // collapsed; same throw contract, only the input + matched substring vary.
  describe("error handling", () => {
    it.each([
      ["unknown",     "Unsupported agent: unknown"],
      ["",            "Unsupported agent: "],
      ["nonexistent", "nonexistent"]
    ])("throws for invalid name '%s'", (name, match) => {
      expect(() => createAgent(name, config, logger)).toThrow(match);
    });
  });

  describe("passes config and logger to agent", () => {
    it("created agent receives name, config, and logger", () => {
      const agent = createAgent("claude", config, logger);
      expect(agent.name).toBe("claude");
      expect(agent.config).toBe(config);
      expect(agent.logger).toBe(logger);
    });
  });

  describe("getAvailableAgents", () => {
    it("returns all 5 built-in agents", () => {
      const agents = getAvailableAgents();
      const names = agents.map(a => a.name);
      expect(names).toContain("claude");
      expect(names).toContain("codex");
      expect(names).toContain("gemini");
      expect(names).toContain("aider");
      expect(names).toContain("opencode");
    });

    it("each agent entry includes AgentClass", () => {
      const agents = getAvailableAgents();
      for (const agent of agents) {
        expect(agent.AgentClass).toBeDefined();
        expect(agent.AgentClass.prototype).toBeInstanceOf(BaseAgent);
      }
    });

    it("each built-in agent entry includes bin metadata", () => {
      const agents = getAvailableAgents();
      const builtIn = agents.filter(a => ["claude", "codex", "gemini", "aider", "opencode"].includes(a.name));
      for (const agent of builtIn) {
        expect(agent.bin).toBeDefined();
        expect(typeof agent.bin).toBe("string");
      }
    });
  });

  describe("getAgentMeta", () => {
    it("returns metadata for a registered agent", () => {
      const meta = getAgentMeta("claude");
      expect(meta).toBeDefined();
      expect(meta.bin).toBe("claude");
      expect(meta.installUrl).toContain("anthropic");
    });

    it("returns null for an unknown agent", () => {
      const meta = getAgentMeta("nonexistent");
      expect(meta).toBeNull();
    });
  });

  // merged-from: 3 invalid-name tests for registerAgent (empty / null / number)
  // collapsed into one it.each; identical throw contract, only the bad input varies.
  describe("registerAgent", () => {
    it.each([
      ["empty string", ""],
      ["null",         null],
      ["number",       42]
    ])("throws when name is %s", (_label, badName) => {
      expect(() => registerAgent(badName, BaseAgent)).toThrow("Agent name must be a non-empty string");
    });
  });
});
