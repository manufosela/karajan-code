import { describe, expect, it, vi } from "vitest";
import { createAgent, getAvailableAgents, getAgentMeta, registerAgent } from "../../src/agents/index.js";
import { ClaudeAgent } from "../../src/agents/claude-agent.js";
import { CodexAgent } from "../../src/agents/codex-agent.js";
import { GeminiAgent } from "../../src/agents/gemini-agent.js";
import { AiderAgent } from "../../src/agents/aider-agent.js";
import { OpenCodeAgent } from "../../src/agents/opencode-agent.js";
import { BaseAgent } from "../../src/agents/base-agent.js";

const config = { roles: {}, coder_options: {}, reviewer_options: {} };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("createAgent factory", () => {
  describe("creates correct agent instances", () => {
    it("createAgent('claude') returns ClaudeAgent instance", () => {
      const agent = createAgent("claude", config, logger);
      expect(agent).toBeInstanceOf(ClaudeAgent);
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    it("createAgent('codex') returns CodexAgent instance", () => {
      const agent = createAgent("codex", config, logger);
      expect(agent).toBeInstanceOf(CodexAgent);
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    it("createAgent('gemini') returns GeminiAgent instance", () => {
      const agent = createAgent("gemini", config, logger);
      expect(agent).toBeInstanceOf(GeminiAgent);
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    it("createAgent('aider') returns AiderAgent instance", () => {
      const agent = createAgent("aider", config, logger);
      expect(agent).toBeInstanceOf(AiderAgent);
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    it("createAgent('opencode') returns OpenCodeAgent instance", () => {
      const agent = createAgent("opencode", config, logger);
      expect(agent).toBeInstanceOf(OpenCodeAgent);
      expect(agent).toBeInstanceOf(BaseAgent);
    });
  });

  describe("error handling", () => {
    it("throws for unknown agent name", () => {
      expect(() => createAgent("unknown", config, logger)).toThrow("Unsupported agent: unknown");
    });

    it("throws for empty string agent name", () => {
      expect(() => createAgent("", config, logger)).toThrow("Unsupported agent: ");
    });

    it("throws with descriptive message including the agent name", () => {
      expect(() => createAgent("nonexistent", config, logger)).toThrow("nonexistent");
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

  describe("registerAgent", () => {
    it("throws when name is empty", () => {
      expect(() => registerAgent("", BaseAgent)).toThrow("Agent name must be a non-empty string");
    });

    it("throws when name is null", () => {
      expect(() => registerAgent(null, BaseAgent)).toThrow("Agent name must be a non-empty string");
    });

    it("throws when name is a number", () => {
      expect(() => registerAgent(42, BaseAgent)).toThrow("Agent name must be a non-empty string");
    });
  });
});
