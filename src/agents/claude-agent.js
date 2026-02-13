import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class ClaudeAgent extends BaseAgent {
  async runTask(task) {
    const args = ["-p", task.prompt];
    if (this.config.coder_options?.model) args.push("--model", this.config.coder_options.model);
    const res = await runCommand("claude", args);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }

  async reviewTask(task) {
    const res = await runCommand("claude", ["-p", task.prompt, "--output-format", "json"]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }
}
