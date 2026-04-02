import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";
import { getProxyEnv } from "../proxy/proxy-lifecycle.js";

/**
 * Extract token usage from Codex CLI stdout.
 * Codex prints "tokens used\n<number>" at the end, where number may have comma separators.
 * Returns { tokens_out } with the total token count, or null if not found.
 * Since Codex doesn't split input/output, we assign the total to tokens_out
 * as a conservative estimate for cost calculation.
 */
export function extractCodexTokens(stdout) {
  const match = (stdout || "").match(/tokens?\s+used\s*\n\s*([\d,]+)/i);
  if (!match) return null;
  const total = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(total) || total <= 0) return null;
  return { tokens_in: 0, tokens_out: total };
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
    const proxyEnv = getProxyEnv();
    const env = proxyEnv ? { ...process.env, ...proxyEnv } : undefined;
    const res = await runCommand(resolveBin("codex"), args, {
      ...(env && { env }),
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
      input: task.prompt
    });
    const usage = extractCodexTokens(res.stdout);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode, ...usage };
  }
}
