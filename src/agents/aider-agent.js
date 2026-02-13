import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class AiderAgent extends BaseAgent {
  async runTask(task) {
    const res = await runCommand("aider", ["--yes", "--message", task.prompt]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }

  async reviewTask(task) {
    const res = await runCommand("aider", ["--yes", "--message", task.prompt]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }
}
