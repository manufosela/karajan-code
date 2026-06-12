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

  // JSON suppression — cuando el agente emite estructura JSON, la
  // suprimimos por completo SIN marker ("<json suprimido>" confundía
  // tanto como el propio JSON). Si no hay nada útil que decirle al
  // usuario, mejor silencio.
  //
  // Capturamos 4 patrones:
  //   1. Fence multilínea ``` json ... ``` (state in fence hasta cierre).
  //   2. Brace block standalone { ... } o [ ... ] (state hasta brace=0).
  //   3. Línea suelta con ``` o ```json EN CUALQUIER PARTE (incluso
  //      "done: ```json" embedded en texto): suprimida + abre fence
  //      si no estaba abierto.
  //   4. Línea suelta con shape de propiedad JSON (`  "key": ...`,
  //      `  },`, `  ],`, `  {`) cuando NO estamos en bloque: heurística
  //      de "trozo de JSON suelto" — se suprime, no entra al stderr.
  let inJsonBlock = false;
  let fenceMode = false;
  let braceDepth = 0;
  const FULL_FENCE_RE = /^\s*```(?:json)?\s*$/;
  const HAS_FENCE_RE = /```/;
  const STANDALONE_BRACE_OPEN = /^[\s]*[{[]\s*$/;
  // Trozo de línea que es CLARAMENTE sintaxis JSON aislada:
  //   - `  "foo": "bar",`        propiedad
  //   - `  "foo": 123`           propiedad numérica
  //   - `  "foo": {`             apertura de objeto en valor
  //   - `  },` / `  ],` / `  }` / `  ]`  cierre con o sin coma
  // Split in two named patterns (S5843): property line vs closer line.
  const JSON_PROP_LINE_RE = /^\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*.+$/;
  const JSON_CLOSER_LINE_RE = /^\s*[}\]],?\s*$/;
  const JSON_SCRAP_RE = { test: (l) => JSON_PROP_LINE_RE.test(l) || JSON_CLOSER_LINE_RE.test(l) };
  const onOutput = (event) => {
    if (!event || typeof event !== "object") return;
    const raw = typeof event.line === "string" ? event.line : "";
    if (!raw) return;
    const line = raw.replace(/\s+$/, "");
    if (!line) return;
    lastActivityAt = Date.now();
    // Estado: dentro de bloque ya marcado.
    if (inJsonBlock) {
      if (fenceMode) {
        if (HAS_FENCE_RE.test(line)) { inJsonBlock = false; fenceMode = false; }
        return;
      }
      braceDepth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
      if (braceDepth <= 0) { inJsonBlock = false; braceDepth = 0; }
      return;
    }
    // Apertura de bloque por fence (línea es SOLO ``` o ```json).
    if (FULL_FENCE_RE.test(line)) {
      inJsonBlock = true; fenceMode = true; braceDepth = 0;
      return;
    }
    // Apertura de bloque por brace standalone.
    if (STANDALONE_BRACE_OPEN.test(line)) {
      inJsonBlock = true; fenceMode = false; braceDepth = 1;
      return;
    }
    // Fence embedded en texto (línea tipo `done: ```json` o `texto ```).
    // Si la fence está sin cerrar en la misma línea → entra al modo.
    if (HAS_FENCE_RE.test(line)) {
      const fences = (line.match(/```/g) || []).length;
      if (fences % 2 === 1) {           // impar → queda fence abierto
        inJsonBlock = true; fenceMode = true; braceDepth = 0;
      }
      return;                            // suprimida en cualquier caso
    }
    // Trozo de JSON suelto sin fence: suprimir silenciosamente.
    if (JSON_SCRAP_RE.test(line)) return;
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
