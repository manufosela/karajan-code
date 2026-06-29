import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract usage from the Copilot CLI JSONL stream (--output-format json,
 * reviewTask). Copilot reports per-message `outputTokens` on each
 * `assistant.message` and a final `result` line with `usage.premiumRequests`
 * (billing units, not tokens). No prompt-token count exists, so tokens_in and
 * cached_tokens stay 0 and tokens_out sums the outputs. Returns null when no
 * token count is present (= unmeasured).
 */
function extractCopilotUsage(text) {
  if (!text) return null;
  let tokens_out = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj?.type === "assistant.message" && typeof obj.data?.outputTokens === "number") {
      tokens_out += obj.data.outputTokens;
    }
  }
  if (tokens_out <= 0) return null;
  return { tokens_in: 0, tokens_out, cached_tokens: 0 };
}

/**
 * Extract the final assistant text from a Copilot JSONL stream: the answer is
 * the last `assistant.message` content; fall back to raw text when none parse.
 */
function extractCopilotText(text) {
  if (!text) return "";
  const messages = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj?.type === "assistant.message" && typeof obj.data?.content === "string") {
      messages.push(obj.data.content);
    }
  }
  return messages.length ? messages.join("") : text;
}

export class CopilotAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, false);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Copilot model "${model}" not supported - retrying with agent default`);
      return this._exec(task, null, false);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, true);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Copilot model "${model}" not supported - retrying with agent default`);
      return this._exec(task, null, true);
    }
    return result;
  }

  async _exec(task, model, jsonFormat) {
    const args = ["-p", task.prompt, "-s", "--allow-all-tools", "--no-ask-user"];
    if (jsonFormat) args.push("--output-format", "json");
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("copilot"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    const output = jsonFormat ? extractCopilotText(res.stdout) : res.stdout;
    const usage = extractCopilotUsage(res.stdout) ?? extractCopilotUsage(res.stderr);
    return { ok: res.exitCode === 0, output, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
