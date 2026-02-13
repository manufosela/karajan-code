import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class ClaudeAgent extends BaseAgent {
  async runTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const args = ["-p", task.prompt];
    if (this.config.coder_options?.model) args.push("--model", this.config.coder_options.model);
    const res = await runCommand("claude", args, { timeout });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }

  async reviewTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const res = await runCommand("claude", ["-p", task.prompt, "--output-format", "json"], { timeout });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
