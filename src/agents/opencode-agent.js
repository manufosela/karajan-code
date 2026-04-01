import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";
import { getProxyEnv } from "../proxy/proxy-lifecycle.js";

export class OpenCodeAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, false);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`OpenCode model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, false);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._exec(task, model, true);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`OpenCode model "${model}" not supported — retrying with agent default`);
      return this._exec(task, null, true);
    }
    return result;
  }

  async _exec(task, model, jsonFormat) {
    const args = ["run"];
    if (jsonFormat) args.push("--format", "json");
    if (model) args.push("--model", model);
    args.push(task.prompt);
    const proxyEnv = getProxyEnv();
    const env = proxyEnv ? { ...process.env, ...proxyEnv } : undefined;
    const res = await runCommand(resolveBin("opencode"), args, {
      ...(env && { env }),
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
