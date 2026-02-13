import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class CodexAgent extends BaseAgent {
  async runTask(task) {
    const args = ["exec", task.prompt];
    if (this.config.coder_options?.auto_approve) args.unshift("--full-auto");
    const res = await runCommand("codex", args);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }

  async reviewTask(task) {
    const res = await runCommand("codex", ["exec", "--json", task.prompt]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }
}
