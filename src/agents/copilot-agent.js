import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * GitHub Copilot CLI (@github/copilot, binary `copilot`) — KJC-TSK-0666.
 * The seventh built-in agent, and the user-chosen third AI for solomon
 * arbitration (gemini tier retired, Qwen OAuth free tier discontinued).
 *
 * Verified live against copilot 1.0.73:
 *  - `-p <prompt>` runs non-interactive; copilot has NO stdin prompt channel
 *    (stdin is treated as context, spawning an agentic run) — so the prompt
 *    travels as an argument. Same documented E2BIG limit as claude-agent
 *    (KJC-BUG-0121) for multi-hundred-KB diffs.
 *  - `--output-format json` emits JSONL; the final text lives in the
 *    `assistant.message` event's `data.content`, run metadata in `result`.
 *  - Default model routing is automatic and varies per run (haiku, gpt-5-mini
 *    observed) — pin it per role via `roles.<role>.model` when neutrality
 *    matters (e.g. a gemini-family model for solomon).
 */
export class CopilotAgent extends BaseAgent {
  async runTask(task) {
    // Coder mode IS an agentic run: file edits and shell need permissions.
    return this._exec(task, this.getRoleModel(task.role || "coder"), ["--allow-all-tools"]);
  }

  async reviewTask(task) {
    // Review/arbitration answers from the prompt alone — no tool grants, and
    // an explicit no-tools instruction so copilot never stalls waiting for
    // an approval that headless mode cannot give.
    return this._exec(
      { ...task, prompt: `Do NOT use any tools. Answer directly from this prompt only.\n\n${task.prompt}` },
      this.getRoleModel(task.role || "reviewer"),
      [],
    );
  }

  async _exec(task, model, extraArgs) {
    const args = ["-p", task.prompt, "--output-format", "json", "--no-color", ...extraArgs];
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("copilot"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    });
    const output = extractCopilotOutput(res.stdout);
    return { ok: res.exitCode === 0, output: output ?? res.stdout, error: res.stderr, exitCode: res.exitCode };
  }
}

/** Last `assistant.message` content from copilot's JSONL stream (null if none). */
export function extractCopilotOutput(stdout) {
  if (!stdout) return null;
  let content = null;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const obj = JSON.parse(t);
      if (obj?.type === "assistant.message" && typeof obj?.data?.content === "string") {
        content = obj.data.content;
      }
    } catch { /* non-JSON noise between events */ }
  }
  return content;
}
