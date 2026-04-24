/**
 * CLI progress reporter — prints live agent activity to the terminal while
 * an agent (planner, coder, reviewer, auditor, …) is thinking.
 *
 * Context: commands like `kj plan --task-file spec.md` used to call
 * `agent.runTask(...)` without an `onOutput` callback. The CLI then hung
 * for 30 s – 3 min with zero feedback until a line like "Plan saved: …"
 * finally appeared. Users assumed the command had deadlocked.
 *
 * This helper gives every CLI command the same live feedback the `kj run`
 * orchestrator already emits: a header with role + start, a stream of
 * tool calls / short text lines as the agent works, and a footer with
 * outcome + elapsed time. It wraps `onOutput` so every command can pass
 * `createCliProgressReporter({ role: "planner" }).onOutput` straight
 * into the agent's runTask / reviewTask call.
 *
 * Output shape:
 *
 *   [planner] starting...
 *     ▸ Read SPEC.md
 *     ▸ Grep "architecture"
 *     · Analyzing sections 1–5…
 *     ▸ Write plan.json
 *   [planner] done (42.8s)
 *
 * Design notes:
 *   - Writes to `process.stderr` by default (so stdout is reserved for
 *     structured output like `--json` mode).
 *   - `onOutput` is shaped as `{ stream, line, kind }` to match the
 *     contract Claude's `createStreamJsonFilter` emits — so passing
 *     this reporter's `onOutput` into a runTask{…, onOutput} call Just
 *     Works with Claude, Codex, Gemini, Aider and OpenCode (each one's
 *     agent wrapper already normalizes its CLI's stream format into
 *     that shape).
 *   - `kind` is optional; when absent the default bullet is used.
 *   - `quiet: true` turns the reporter into a no-op (useful when the
 *     command is running under `--json` and should not pollute stdout).
 */

const ICONS = {
  tool: "▸",      // ▸ right-pointing small triangle
  text: "·",      // · middle dot
  thinking: "…",  // …
};

/**
 * @typedef {Object} CliProgressReporter
 * @property {(event: { stream?: string, line: string, kind?: string }) => void} onOutput
 * @property {(outcome?: string) => void} finish
 */

/**
 * @param {Object} [opts]
 * @param {string} [opts.role]     - label shown in the header/footer ("planner", "auditor", …).
 *                                   Default: "agent".
 * @param {NodeJS.WriteStream} [opts.stream]  - output destination. Default: process.stderr.
 * @param {boolean} [opts.quiet]   - when true, nothing is printed (useful for --json mode).
 * @returns {CliProgressReporter}
 */
export function createCliProgressReporter(opts = {}) {
  const { role = "agent", stream = process.stderr, quiet = false } = opts;

  if (quiet) {
    return { onOutput: () => {}, finish: () => {} };
  }

  const startedAt = Date.now();
  stream.write(`[${role}] starting...\n`);

  const onOutput = (event) => {
    if (!event || typeof event !== "object") return;
    const raw = typeof event.line === "string" ? event.line : "";
    if (!raw) return;
    // Strip trailing newline — we re-add our own.
    const line = raw.replace(/\s+$/, "");
    if (!line) return;
    const icon = ICONS[event.kind] || ICONS.text;
    stream.write(`  ${icon} ${line}\n`);
  };

  /**
   * @param {string} [outcome]  default "done". Use "failed", "stopped", "timeout" etc.
   */
  const finish = (outcome = "done") => {
    const ms = Date.now() - startedAt;
    const s = (ms / 1000).toFixed(1);
    stream.write(`[${role}] ${outcome} (${s}s)\n`);
  };

  return { onOutput, finish };
}
