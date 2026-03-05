import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

export class OpenCodeAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const args = ["run"];
    const model = this.getRoleModel(role);
    if (model) args.push("--model", model);
    args.push(task.prompt);
    const res = await runCommand(resolveBin("opencode"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const args = ["run", "--format", "json"];
    const model = this.getRoleModel(role);
    if (model) args.push("--model", model);
    args.push(task.prompt);
    const res = await runCommand(resolveBin("opencode"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
