import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract usage from Pi CLI JSONL output.
 * Pi CLI with --mode json emits JSONL (one JSON object per line).
 * We look for messages containing token usage information.
 */
function extractPiUsage(text) {
  if (!text) return null;
  
  const lines = text.trim().split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    
    try {
      const obj = JSON.parse(t);
      
      // Look for usage in various possible locations
      const usage = obj?.usage 
        ?? obj?.data?.usage
        ?? obj?.result?.usage
        ?? (obj?.type === "usage" ? obj : null);
      
      if (usage && typeof usage.prompt_tokens === "number") {
        return {
          tokens_in: usage.prompt_tokens,
          tokens_out: usage.completion_tokens ?? 0,
          cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0
        };
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

export class PiAgent extends BaseAgent {
  /**
   * Run a coding/agentic task through Pi CLI.
   * @param {Object} task - Task object with prompt, role, timeout, etc.
   * @returns {Promise<import("../types/agent.js").AgentResult>}
   */
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model);
    
    // Retry with default model if specified model not supported
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Pi model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null);
    }
    
    return result;
  }

  /**
   * Run a review task through Pi CLI.
   * @param {Object} task - Task object with prompt, role, timeout, etc.
   * @returns {Promise<import("../types/agent.js").AgentResult>}
   */
  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model);
    
    // Retry with default model if specified model not supported
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Pi model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null);
    }
    
    return result;
  }

  /**
   * Execute a Pi CLI command in print mode.
   * @param {Object} task - Task object with prompt, timeout, etc.
   * @param {string|null} model - Model to use (null for default)
   * @returns {Promise<import("../types/agent.js").AgentResult>}
   */
  async _exec(task, model) {
    // Build arguments for Pi CLI
    // Reference: https://pi.dev/docs/latest/usage
    const args = ["-p"]; // Print mode: execute and exit
    
    if (model) {
      args.push("--model", model);
    }
    
    // Use JSON mode for structured output parsing
    args.push("--mode", "json");
    
    const res = await this.runCommand(resolveBin("pi"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
      input: task.prompt
    });
    
    // Extract usage metrics from JSONL output
    const usage = extractPiUsage(res.stdout) ?? extractPiUsage(res.stderr);
    
    return {
      ok: res.exitCode === 0,
      output: res.stdout,
      error: res.stderr,
      exitCode: res.exitCode,
      ...(usage ?? {})
    };
  }
}
