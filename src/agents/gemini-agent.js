import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

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
    const res = await runCommand(resolveBin("gemini"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
