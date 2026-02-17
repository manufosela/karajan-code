import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class AiderAgent extends BaseAgent {
  async runTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const res = await runCommand("aider", ["--yes", "--message", task.prompt], { timeout, onOutput: task.onOutput });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }

  async reviewTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const res = await runCommand("aider", ["--yes", "--message", task.prompt], { timeout, onOutput: task.onOutput });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
