import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

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
    const res = await runCommand(resolveBin("aider"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
