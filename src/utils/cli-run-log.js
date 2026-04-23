/**
 * Shared run.log wrapper for CLI commands.
 *
 * Every MCP handler (`kj_run`, `kj_audit`, `kj_code`, `kj_review`, ...) writes
 * progress + lifecycle events to `<projectDir>/.kj/run.log` via
 * `createRunLog()`. `kj-tail` reads that file in real time to show pipeline
 * activity. Until this module, the CLI (`kj run`, `kj audit`, ...) did NOT
 * write that log at all, so running the same command as a shell (vs MCP)
 * produced silence in `kj-tail`. This helper closes that asymmetry: CLI
 * commands that opt in get the same run.log behavior as MCP.
 *
 * Usage pattern:
 *
 *   import { withCliRunLog } from "../utils/cli-run-log.js";
 *
 *   export async function fooCommand({ task, config, logger }) {
 *     return withCliRunLog("foo", { projectDir: config.projectDir }, async ({ runLog, forwardProgress }) => {
 *       runLog.logText(`[kj_foo] args — task="${task.slice(0, 80)}"`);
 *
 *       const emitter = new EventEmitter();
 *       forwardProgress(emitter);   // every emitter.emit("progress", event) also lands in run.log
 *
 *       // ... run the work ...
 *       return { ok: true };
 *     });
 *   }
 *
 * The wrapper guarantees:
 *   - `.kj/run.log` is created/truncated at the start.
 *   - A `[kj_<cmd>] started` line is written immediately so kj-tail shows the
 *     command began (even if no emitter events follow — e.g. `kj audit` which
 *     streams agent output directly).
 *   - A `[kj_<cmd>] finished` (or `failed — <error>`) line is written at the
 *     end, even if the inner function throws.
 *   - The file descriptor is always closed.
 *   - `forwardProgress(emitter)` is a no-op when the command doesn't use an
 *     EventEmitter (e.g. one-shot agent calls). Commands that do emit
 *     progress events (like `kj run`) get the same per-event coverage as MCP.
 */

import { createRunLog } from "./run-log.js";

/**
 * Wrap a CLI command body with run.log lifecycle management.
 *
 * @template T
 * @param {string} commandName         - short slug, e.g. "run", "audit", "code"
 * @param {Object}  opts
 * @param {string} [opts.projectDir]   - project root; defaults to `process.cwd()`
 * @param {Object} [opts.logger]       - optional logger for close-time warnings
 * @param {(ctx: {
 *   runLog: ReturnType<typeof createRunLog>,
 *   forwardProgress: (emitter: import("node:events").EventEmitter) => void,
 * }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withCliRunLog(commandName, opts, fn) {
  const projectDir = opts?.projectDir || process.cwd();
  const runLog = createRunLog(projectDir);

  runLog.logText(`[kj_${commandName}] started (cli)`);

  const forwardProgress = (emitter) => {
    if (!emitter || typeof emitter.on !== "function") return;
    emitter.on("progress", (event) => {
      try {
        runLog.logEvent(event);
      } catch { /* best-effort */ }
    });
  };

  try {
    const result = await fn({ runLog, forwardProgress });
    const ok = result && result.ok !== false;
    runLog.logText(`[kj_${commandName}] finished — ok=${ok}`);
    return result;
  } catch (err) {
    runLog.logText(`[kj_${commandName}] failed — ${err?.message || String(err)}`);
    throw err;
  } finally {
    runLog.close();
  }
}
