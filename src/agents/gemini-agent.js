import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";

export class GeminiAgent extends BaseAgent {
  async runTask(task) {
    const res = await runCommand("gemini", ["-p", task.prompt]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }

  async reviewTask(task) {
    const res = await runCommand("gemini", ["-p", task.prompt, "--output-format", "json"]);
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr };
  }
}
