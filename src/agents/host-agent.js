/**
 * Host Agent — delegates task execution to the MCP host AI via elicitation.
 *
 * Instead of spawning a subprocess, returns the prompt to the host AI
 * (Claude, Codex, etc.) for direct execution. The host has full access
 * to the codebase and tools — no subprocess overhead.
 *
 * Used when: the MCP host IS the same agent configured for a role.
 */

import { BaseAgent } from "./base-agent.js";

export class HostAgent extends BaseAgent {
  constructor(config, logger, { askHost }) {
    super("host", config, logger);
    this._askHost = askHost;
  }

  async runTask(task) {
    const { prompt, onOutput } = task;

    if (!this._askHost) {
      return { ok: false, output: "", error: "Host agent has no askHost callback" };
    }

    if (onOutput) onOutput({ stream: "info", line: "[host-agent] Delegating to host AI..." });

    const answer = await this._askHost(prompt);

    if (!answer) {
      return { ok: false, output: "", error: "Host AI declined or returned no response" };
    }

    if (onOutput) onOutput({ stream: "info", line: "[host-agent] Host AI completed task" });

    return { ok: true, output: answer, exitCode: 0 };
  }
}
