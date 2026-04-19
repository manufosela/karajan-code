// @ts-check
import { runCli } from '../cli-runner.js';
import { parseCliOutput } from '../output-parser.js';

/**
 * @typedef {import('../cli-runner.js').CliRunResult} CliRunResult
 * @typedef {import('../output-parser.js').ParsedOutput} ParsedOutput
 */

/**
 * @typedef {Object} CodexMeta
 * @property {string | null} threadId Codex conversation / thread identifier when available.
 * @property {unknown | null} usage Token usage metadata reported by Codex, if present.
 * @property {unknown[]} events Parsed NDJSON event stream (useful for debugging).
 */

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [binary] Override the Codex CLI binary name/path. Defaults to "codex".
 * @property {string[]} [extraArgs] Additional flags appended before the prompt.
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} [timeoutMs]
 * @property {typeof runCli} [runner] Inyección de dependencia para facilitar tests.
 * @property {typeof parseCliOutput} [parser]
 */

/**
 * @typedef {Object} AdapterResult
 * @property {"codex"} provider
 * @property {CliRunResult} process
 * @property {ParsedOutput} parsedOutput
 * @property {CodexMeta} [providerMeta] Codex-specific metadata (streaming events, usage, thread).
 */

// NOTA: Los flags exactos dependen de la versión instalada del CLI de Codex.
// Se usa `exec --json --skip-git-repo-check <prompt>` como convención:
//   - `exec --json` para modo no interactivo con salida NDJSON (streaming de eventos).
//   - `--skip-git-repo-check` para permitir ejecutar fuera de un repo git de confianza
//     (por defecto Codex aborta con "Not inside a trusted directory").
// Si una versión concreta difiere, ajustar `buildCodexArgs` sin tocar el resto del módulo.

/**
 * Build the argv array passed to the Codex CLI.
 * @param {string} prompt
 * @param {string[]} [extraArgs]
 * @returns {string[]}
 */
function buildCodexArgs(prompt, extraArgs = []) {
  return ['exec', '--json', '--skip-git-repo-check', ...extraArgs, prompt];
}

/**
 * Parse NDJSON stdout into an array of events. Lines that are not valid JSON are skipped.
 *
 * @param {string} stdout
 * @returns {unknown[]}
 */
function parseNdjsonEvents(stdout) {
  if (!stdout) return [];
  const events = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Línea no-JSON (p. ej. aviso informativo): la ignoramos.
    }
  }
  return events;
}

/**
 * Extract Codex-specific signals from the NDJSON event stream:
 *   - the final assistant message text (agent_message),
 *   - the thread id,
 *   - the usage stats.
 *
 * @param {unknown[]} events
 * @returns {{ agentText: string | null, threadId: string | null, usage: unknown | null }}
 */
function extractCodexSignals(events) {
  let agentText = null;
  let threadId = null;
  let usage = null;

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const ev = /** @type {Record<string, unknown>} */ (event);

    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') {
      threadId = ev.thread_id;
    }
    if (ev.type === 'turn.completed' && ev.usage) {
      usage = ev.usage;
    }
    if (ev.type === 'item.completed' && ev.item && typeof ev.item === 'object') {
      const item = /** @type {Record<string, unknown>} */ (ev.item);
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        // Guardamos el último agent_message por si hay varios en un turno.
        agentText = item.text;
      }
    }
  }

  return { agentText, threadId, usage };
}

/**
 * Run a prompt against the Codex CLI and normalize its output.
 *
 * Codex emite NDJSON en stdout (un evento por línea): `thread.started`,
 * `turn.started`, `item.completed` (con `item.type === "agent_message"`) y
 * `turn.completed`. Este adaptador localiza el `agent_message` final y pasa
 * SU texto al parser común, de modo que `parsedOutput` refleje la respuesta real
 * y no un evento de streaming.
 *
 * @param {string} prompt Text prompt to send to Codex.
 * @param {AdapterOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runCodexCli(prompt, options = {}) {
  const {
    binary = 'codex',
    extraArgs,
    cwd,
    env,
    timeoutMs,
    runner = runCli,
    parser = parseCliOutput,
  } = options;

  const args = buildCodexArgs(prompt, extraArgs);
  const processResult = await runner(binary, { args, cwd, env, timeoutMs });

  const events = parseNdjsonEvents(processResult.stdout);
  const { agentText, threadId, usage } = extractCodexSignals(events);

  // Si hay agent_message en el stream lo usamos como input del parser;
  // en otro caso caemos al stdout bruto (p. ej. salidas no-NDJSON).
  const textForParser = agentText ?? processResult.stdout;
  const parsedOutput = parser(textForParser, processResult.stderr);

  return {
    provider: 'codex',
    process: processResult,
    parsedOutput,
    providerMeta: { threadId, usage, events },
  };
}
