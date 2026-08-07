import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Kimi Code (Moonshot, binary `kimi`) — KJC-TSK-0729 fase 2: the eighth
 * built-in agent and the free-tier reserve of the reviewer/solomon panel.
 *
 * Verified live against kimi-code 0.27.0:
 *  - `-p <prompt>` runs one prompt non-interactively and prints the
 *    response (text output by default) — the prompt travels as an argument,
 *    same E2BIG caveat as claude/copilot (KJC-BUG-0121) for huge diffs.
 *  - `-m <model>` picks a model alias; `-y` auto-approves actions.
 *  - Auth is the device-code login (`kimi login`), no env keys involved;
 *    "No model configured" on a logged machine means the login did not
 *    populate the managed provider (re-run `kimi login`).
 */
export class KimiAgent extends BaseAgent {
  async runTask(task) {
    // Coder mode IS an agentic run: file edits and shell need approval.
    return this._exec(task, this.getRoleModel(task.role || "coder"), ["-y"]);
  }

  async reviewTask(task) {
    // Review/arbitration answers from the prompt alone — no auto-approval,
    // and an explicit no-tools instruction so a headless run never stalls
    // waiting for a permission prompt nobody can answer.
    return this._exec(
      { ...task, prompt: `Do NOT use any tools. Answer directly from this prompt only.\n\n${task.prompt}` },
      this.getRoleModel(task.role || "reviewer"),
      [],
    );
  }

  async _exec(task, model, extraArgs) {
    const args = ["-p", task.prompt, ...extraArgs];
    if (model) args.push("-m", model);
    const res = await this.runCommand(resolveBin("kimi"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
    });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}
