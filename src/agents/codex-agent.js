import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Try to extract an OpenAI-style `usage` JSON block from codex stdout.
 *
 * OpenAI's Chat Completions API exposes prompt-cache hits via
 * `usage.prompt_tokens_details.cached_tokens` (since Aug 2024). Codex
 * CLI doesn't surface this in its default footer, but newer flags or a
 * wrapper may emit a JSON `usage` line. We scan stdout line-by-line and
 * accept the first parseable object that carries `prompt_tokens`.
 *
 * Returns `{tokens_in, tokens_out, cached_tokens}` or null when absent.
 */
function extractJsonUsage(stdout) {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    const usage = obj?.usage ?? (typeof obj?.prompt_tokens === "number" ? obj : null);
    if (!usage || typeof usage.prompt_tokens !== "number") continue;
    return {
      tokens_in: usage.prompt_tokens,
      tokens_out: usage.completion_tokens ?? 0,
      cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0
    };
  }
  return null;
}

/**
 * Extract token usage from Codex CLI stdout. Two shapes are supported:
 *
 *   1. OpenAI-style JSON `usage` block (preferred):
 *      `{"usage":{"prompt_tokens":N,"completion_tokens":M,
 *                 "prompt_tokens_details":{"cached_tokens":C}}}`
 *      → `{tokens_in:N, tokens_out:M, cached_tokens:C}`.
 *
 *   2. Legacy "tokens used\n<number>" footer (codex's default total,
 *      no cache visibility) → `{tokens_in:0, tokens_out, cached_tokens:0}`.
 *
 * Returns null when neither shape is found.
 */
function extractCodexTokens(stdout) {
  if (!stdout) return null;
  const json = extractJsonUsage(stdout);
  if (json) return json;
  const match = stdout.match(/tokens?\s+used\s*\n\s*([\d,]+)/i);
  if (!match) return null;
  const total = Number(match[1].replaceAll(/,/g, ""));
  if (!Number.isFinite(total) || total <= 0) return null;
  return { tokens_in: 0, tokens_out: total, cached_tokens: 0 };
}

export class CodexAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, role);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Codex model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, role);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, role);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Codex model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, role);
    }
    return result;
  }

  async _exec(task, model, role) {
    const args = ["exec", "--skip-git-repo-check"];
    if (model) args.push("--model", model);
    if (role !== "reviewer" && this.isAutoApproveEnabled(role)) args.push("--full-auto");
    args.push("-");
    const res = await this.runCommand(resolveBin("codex"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
      input: task.prompt,
      // TOR-A (KJC-TSK-0723): tournament lanes run the coder INSIDE the lane.
      cwd: task.cwd
    });
    const usage = extractCodexTokens(res.stdout);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
