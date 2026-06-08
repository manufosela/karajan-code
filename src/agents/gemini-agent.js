import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract Gemini's `usageMetadata` from stdout, including
 * `cachedContentTokenCount` (Gemini's context-caching API metric,
 * https://ai.google.dev/api/caching).
 *
 * The gemini CLI emits `usageMetadata` as part of its JSON response
 * shape (today: only `--output-format json`, used in reviewTask; in
 * plain runTask mode no usage is surfaced). When absent, returns null
 * so the caller leaves `cached_tokens` undefined (= unmeasured,
 * distinct from a measured 0).
 */
export function extractGeminiUsage(text) {
  if (!text) return null;
  const candidates = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("{") || t.startsWith("[")) candidates.push(t);
  }
  candidates.push(text.trim());
  for (const candidate of candidates) {
    let obj;
    try { obj = JSON.parse(candidate); } catch { continue; }
    const meta = obj?.usageMetadata
      ?? obj?.usage_metadata
      ?? obj?.response?.usageMetadata;
    if (!meta || typeof meta.promptTokenCount !== "number") continue;
    return {
      tokens_in: meta.promptTokenCount,
      tokens_out: meta.candidatesTokenCount ?? 0,
      cached_tokens: meta.cachedContentTokenCount ?? 0
    };
  }
  return null;
}

export class GeminiAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, "run");
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Gemini model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, "run");
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, "review");
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Gemini model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, "review");
    }
    return result;
  }

  async _exec(task, model, mode) {
    const args = ["-p", task.prompt];
    if (mode === "review") args.push("--output-format", "json");
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("gemini"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    const usage = extractGeminiUsage(res.stdout) ?? extractGeminiUsage(res.stderr);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
