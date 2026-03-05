import { ClaudeAgent } from "./claude-agent.js";
import { CodexAgent } from "./codex-agent.js";
import { GeminiAgent } from "./gemini-agent.js";
import { AiderAgent } from "./aider-agent.js";
import { OpenCodeAgent } from "./opencode-agent.js";

const agentRegistry = new Map();

export function registerAgent(name, AgentClass, meta = {}) {
  if (!name || typeof name !== "string") {
    throw new Error("Agent name must be a non-empty string");
  }
  agentRegistry.set(name, { AgentClass, meta });
}

export function getAvailableAgents() {
  return [...agentRegistry.entries()].map(([name, { AgentClass, meta }]) => ({
    name,
    AgentClass,
    ...meta,
  }));
}

export function getAgentMeta(name) {
  const entry = agentRegistry.get(name);
  return entry ? { ...entry.meta } : null;
}

export function createAgent(agentName, config, logger) {
  const entry = agentRegistry.get(agentName);
  if (!entry) {
    throw new Error(`Unsupported agent: ${agentName}`);
  }
  return new entry.AgentClass(agentName, config, logger);
}

// Auto-register built-in agents with CLI metadata
registerAgent("claude", ClaudeAgent, { bin: "claude", installUrl: "https://docs.anthropic.com/en/docs/claude-code" });
registerAgent("codex", CodexAgent, { bin: "codex", installUrl: "https://developers.openai.com/codex/cli" });
registerAgent("gemini", GeminiAgent, { bin: "gemini", installUrl: "https://github.com/google-gemini/gemini-cli" });
registerAgent("aider", AiderAgent, { bin: "aider", installUrl: "https://aider.chat/docs/install.html" });
registerAgent("opencode", OpenCodeAgent, { bin: "opencode", installUrl: "https://opencode.ai" });
