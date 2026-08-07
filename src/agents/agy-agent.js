import { BaseAgent } from "./base-agent.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Antigravity CLI (`agy`) — KJC-TSK-0729 fase 2b: the ninth built-in agent.
 * Google's official successor to the retired gemini CLI (dead 2026-06-18),
 * covered by the user's Google AI Pro/Ultra subscription — the natural
 * third AI for solomon arbitration, back at last.
 *
 * Verified live against agy 1.1.10:
 *  - `-p <prompt>` runs print mode; `--output-format json` emits ONE JSON
 *    object: {status: "SUCCESS", response, usage}. Non-SUCCESS status can
 *    arrive with exit 0, so ok checks BOTH.
 *  - `--disable-slash-commands` keeps prompt content (diffs can contain
 *    "/lines") from expanding as slash commands in print mode.
 *  - Permission prompts are denied in print mode unless
 *    `--dangerously-skip-permissions` (coder mode only).
 *  - Auth lives under ~/.gemini/antigravity-cli (device/browser login).
 */
export class AgyAgent extends BaseAgent {
  async runTask(task) {
    return this._exec(task, this.getRoleModel(task.role || "coder"), ["--dangerously-skip-permissions"]);
  }

  async reviewTask(task) {
    return this._exec(
      { ...task, prompt: `Do NOT use any tools. Answer directly from this prompt only.\n\n${task.prompt}` },
      this.getRoleModel(task.role || "reviewer"),
      [],
    );
  }

  async _exec(task, model, extraArgs) {
    const args = ["-p", task.prompt, "--output-format", "json", "--disable-slash-commands", ...extraArgs];
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("agy"), args, {
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
    });
    const parsed = extractAgyOutput(res.stdout);
    const ok = res.exitCode === 0 && parsed?.status === "SUCCESS";
    return {
      ok,
      output: parsed?.response ?? res.stdout,
      error: ok ? res.stderr : parsed?.error || res.stderr || `agy status: ${parsed?.status || "unparseable"}`,
      exitCode: res.exitCode,
    };
  }
}

/** Parse agy's single-object JSON print output ({status, response}), null if not JSON. */
export function extractAgyOutput(stdout) {
  if (!stdout) return null;
  try {
    const obj = JSON.parse(stdout.trim());
    return typeof obj === "object" && obj !== null ? obj : null;
  } catch {
    return null;
  }
}
