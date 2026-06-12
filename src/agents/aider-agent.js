import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract token usage from Aider's stdout. Two shapes are supported:
 *
 *   1. LiteLLM passthrough — an OpenAI-style JSON `usage` block surfaces
 *      `prompt_tokens_details.cached_tokens` for prompt-cache hits.
 *   2. Aider's native footer "Tokens: <sent> sent, <received> received
 *      [, <cached> cache hit]." (supports comma-separated and `k` suffix).
 *
 * Returns `{tokens_in, tokens_out, cached_tokens}` or null when no usage
 * is found (= unmeasured; callers leave the fields undefined).
 */
function extractAiderUsage(text) {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    const u = obj?.usage ?? (typeof obj?.prompt_tokens === "number" ? obj : null);
    if (!u || typeof u.prompt_tokens !== "number") continue;
    return {
      tokens_in: u.prompt_tokens,
      tokens_out: u.completion_tokens ?? 0,
      cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0
    };
  }
  const m = text.match(/Tokens:\s*([\d.,]+k?)\s*sent,\s*([\d.,]+k?)\s*received(?:,\s*([\d.,]+k?)\s*cache\s*hit)?/i);
  if (!m) return null;
  const parse = (s) => {
    const c = s.replaceAll(",", "");
    return c.toLowerCase().endsWith("k")
      ? Math.round(parseFloat(c.slice(0, -1)) * 1000)
      : Number(c);
  };
  const sent = parse(m[1]);
  const recv = parse(m[2]);
  if (!Number.isFinite(sent) || !Number.isFinite(recv)) return null;
  return { tokens_in: sent, tokens_out: recv, cached_tokens: m[3] ? parse(m[3]) : 0 };
}

export class AiderAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Aider model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Aider model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null);
    }
    return result;
  }

  async _exec(task, model) {
    const args = ["--yes", "--message", task.prompt];
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("aider"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    const usage = extractAiderUsage(res.stdout) ?? extractAiderUsage(res.stderr);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
