import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract usage from Copilot CLI JSONL output.
 * Copilot CLI with --output-format json emits JSONL (one JSON object per line).
 * We look for the first message with usage information.
 */
function extractCopilotUsage(text) {
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

export class CopilotAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, false);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Copilot model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, false);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, true);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Copilot model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, true);
    }
    return result;
  }

  async _exec(task, model, _jsonFormat) {
    const args = ["-p", task.prompt];
    
    // Use JSON output format for structured parsing
    args.push("--output-format", "json");
    
    // Silent mode to reduce noise
    args.push("--silent");
    
    // Allow all tools for autonomous operation
    args.push("--allow-all");
    
    if (model) args.push("--model", model);
    
    const res = await this.runCommand(resolveBin("copilot"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    
    const usage = extractCopilotUsage(res.stdout) ?? extractCopilotUsage(res.stderr);
    return { 
      ok: res.exitCode === 0, 
      output: res.stdout, 
      error: res.stderr, 
      exitCode: res.exitCode, 
      ...(usage ?? {})
    };
  }
}
