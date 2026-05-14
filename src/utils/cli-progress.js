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
  heartbeat: "⠿", // braille dots — distinct from real activity icons
};

/**
 * Rotating idle messages so the user knows the process is alive without
 * the same string repeating every minute. Picked at random each tick;
 * the previous one is held back so two ticks in a row never duplicate.
 */
const HEARTBEAT_LINES = [
  "still working…",
  "thinking through it…",
  "wading through tokens…",
  "asking the model nicely…",
  "crunching the spec…",
  "burning down the prompt…",
  "kneading the context window…",
  "still here, give me a sec…",
  "the LLM is doing LLM things…",
  "drafting, redrafting…",
];

/**
 * Default cadence for the idle heartbeat. ~45s is short enough to feel
 * responsive on a quiet planner run (Claude can think for 1-2 min on a
 * complex spec) without spamming every few seconds.
 */
const DEFAULT_HEARTBEAT_MS = 45_000;

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
 * @param {number}  [opts.heartbeatMs] - silent interval before printing an
 *   "alive" line. Defaults to 45 s. Set to 0 to disable the heartbeat
 *   (useful in tests).
 * @returns {CliProgressReporter}
 */
export function createCliProgressReporter(opts = {}) {
  const {
    role = "agent",
    stream = process.stderr,
    quiet = false,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
  } = opts;

  if (quiet) {
    return { onOutput: () => {}, finish: () => {} };
  }

  const startedAt = Date.now();
  stream.write(`[${role}] starting...\n`);

  // Idle heartbeat: a periodic timer that prints a varied "still alive"
  // line whenever the agent goes quiet for longer than `heartbeatMs`.
  // Reset on every real onOutput so heavy chatter doesn't trigger the
  // duplicate. Always elapses to a different message than last time so
  // two consecutive ticks never read the same.
  let lastActivityAt = Date.now();
  let lastHeartbeatIdx = -1;
  let heartbeatTimer = null;

  function pickHeartbeatLine() {
    let idx;
    do {
      idx = Math.floor(Math.random() * HEARTBEAT_LINES.length);
    } while (idx === lastHeartbeatIdx && HEARTBEAT_LINES.length > 1);
    lastHeartbeatIdx = idx;
    return HEARTBEAT_LINES[idx];
  }

  function tick() {
    const idleFor = Date.now() - lastActivityAt;
    if (idleFor < heartbeatMs) return;        // real activity reset us
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    stream.write(`  ${ICONS.heartbeat} ${pickHeartbeatLine()} (${elapsed}s)\n`);
    lastActivityAt = Date.now();              // collapse next ticks
  }

  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(tick, heartbeatMs);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  }

  // JSON suppression state — cuando el agente emite un bloque JSON
  // multi-línea (``` json ... ``` o `{ ... }` standalone), evitamos
  // imprimirlo línea a línea porque inunda el stderr con ruido
  // estructural que nadie lee. Mostramos un solo marcador
  // `<json suprimido>` la primera vez que abrimos un bloque.
  //
  // Dos modos de cierre:
  //   - fenceMode = true  → terminamos al ver otro ``` (ignora brace count).
  //   - fenceMode = false → terminamos cuando braceDepth llega a 0.
  let inJsonBlock = false;
  let fenceMode = false;
  let braceDepth = 0;
  const JSON_FENCE_RE = /^\s*```(json)?\s*$/;
  const onOutput = (event) => {
    if (!event || typeof event !== "object") return;
    const raw = typeof event.line === "string" ? event.line : "";
    if (!raw) return;
    const line = raw.replace(/\s+$/, "");
    if (!line) return;
    lastActivityAt = Date.now();
    // Detección + supresión de JSON multilínea.
    if (!inJsonBlock) {
      if (JSON_FENCE_RE.test(line)) {
        inJsonBlock = true; fenceMode = true; braceDepth = 0;
        stream.write(`  ${ICONS.text} <json suprimido>\n`);
        return;
      }
      if (/^[\s]*[{[]\s*$/.test(line)) {
        inJsonBlock = true; fenceMode = false; braceDepth = 1;
        stream.write(`  ${ICONS.text} <json suprimido>\n`);
        return;
      }
    } else if (fenceMode) {
      if (JSON_FENCE_RE.test(line)) { inJsonBlock = false; fenceMode = false; }
      return; // sigue dentro del fence
    } else {
      braceDepth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
      if (braceDepth <= 0) { inJsonBlock = false; braceDepth = 0; }
      return; // sigue dentro del brace-block
    }
    const icon = ICONS[event.kind] || ICONS.text;
    stream.write(`  ${icon} ${line}\n`);
  };

  /**
   * @param {string} [outcome]  default "done". Use "failed", "stopped", "timeout" etc.
   */
  const finish = (outcome = "done") => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const ms = Date.now() - startedAt;
    const s = (ms / 1000).toFixed(1);
    stream.write(`[${role}] ${outcome} (${s}s)\n`);
  };

  return { onOutput, finish };
}
