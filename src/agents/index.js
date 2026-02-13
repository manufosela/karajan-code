import { ClaudeAgent } from "./claude-agent.js";
import { CodexAgent } from "./codex-agent.js";
import { GeminiAgent } from "./gemini-agent.js";
import { AiderAgent } from "./aider-agent.js";

export function createAgent(agentName, config, logger) {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent(agentName, config, logger);
    case "codex":
      return new CodexAgent(agentName, config, logger);
    case "gemini":
      return new GeminiAgent(agentName, config, logger);
    case "aider":
      return new AiderAgent(agentName, config, logger);
    default:
      throw new Error(`Unsupported agent: ${agentName}`);
  }
}
