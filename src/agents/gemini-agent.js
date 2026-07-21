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
function extractGeminiUsage(text) {
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
  // Overridden by forks with the same headless interface (QwenAgent).
  get cliBin() { return "gemini"; }
  get spawnEnv() { return { GEMINI_CLI_TRUST_WORKSPACE: "true" }; }

  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, "run");
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`${this.cliBin} model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, "run");
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, "review");
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`${this.cliBin} model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, "review");
    }
    return result;
  }

  async _exec(task, model, mode) {
    // KJC-BUG-0121: the prompt NEVER travels as a CLI argument — a solomon
    // prompt embeds the full diff, and large diffs blow past the kernel's
    // per-argument limit (E2BIG). gemini reads the prompt from stdin in
    // headless mode. Same bug's layer 2: headless gemini refuses untrusted
    // workspaces unless GEMINI_CLI_TRUST_WORKSPACE is set.
    const args = [];
    if (mode === "review") args.push("--output-format", "json");
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin(this.cliBin), args, {
      input: task.prompt,
      env: this.spawnEnv,
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    const usage = extractGeminiUsage(res.stdout) ?? extractGeminiUsage(res.stderr);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
