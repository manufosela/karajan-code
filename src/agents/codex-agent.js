import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

export class CodexAgent extends BaseAgent {
  async runTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const role = task.role || "coder";
    const args = ["exec"];
    const model = this.getRoleModel(role);
    if (model) args.push("--model", model);
    if (this.isAutoApproveEnabled(role)) args.push("--full-auto");
    args.push(task.prompt);
    const res = await runCommand(resolveBin("codex"), args, { timeout, onOutput: task.onOutput });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }

  async reviewTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const args = ["exec"];
    const model = this.getRoleModel(task.role || "reviewer");
    if (model) args.push("--model", model);
    args.push(task.prompt);
    const res = await runCommand(resolveBin("codex"), args, { timeout, onOutput: task.onOutput });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
