// @ts-check
import { runCli } from '../cli-runner.js';
import { parseCliOutput } from '../output-parser.js';

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [binary] Override the Claude CLI binary name/path. Defaults to "claude".
 * @property {string[]} [extraArgs] Additional flags prepended before the prompt.
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} [timeoutMs]
 * @property {typeof runCli} [runner] Inyección de dependencia para facilitar tests.
 * @property {typeof parseCliOutput} [parser]
 */

// NOTA: Flags de Claude CLI varían entre versiones. Aquí se asume modo no interactivo
// vía `-p` (print) sin TTY. Ajustar `buildClaudeArgs` si la versión instalada difiere.

/**
 * Wrap the user prompt asking Claude to answer in strict JSON only.
 * Exported so it can be unit-tested independently.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function buildStrictJsonPrompt(prompt) {
  return [
    'Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional,',
    'sin bloques de código y sin explicaciones. El esquema sugerido es:',
    '{ "answer": string, "details"?: string }',
    '',
    'Prompt del usuario:',
    prompt,
  ].join('\n');
}

/**
 * Build the argv array passed to the Claude CLI.
 * @param {string} wrappedPrompt
 * @param {string[]} [extraArgs]
 * @returns {string[]}
 */
function buildClaudeArgs(wrappedPrompt, extraArgs = []) {
  return ['-p', ...extraArgs, wrappedPrompt];
}

/**
 * Run a prompt against the Claude CLI and normalize its output.
 *
 * @param {string} prompt User-level prompt (will be wrapped to request strict JSON).
 * @param {AdapterOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runClaudeCli(prompt, options = {}) {
  const {
    binary = 'claude',
    extraArgs,
    cwd,
    env,
    timeoutMs,
    runner = runCli,
    parser = parseCliOutput,
  } = options;

  const wrapped = buildStrictJsonPrompt(prompt);
  const args = buildClaudeArgs(wrapped, extraArgs);
  const processResult = await runner(binary, { args, cwd, env, timeoutMs });
  const parsedOutput = parser(processResult.stdout, processResult.stderr);

  return {
    provider: 'claude',
    process: processResult,
    parsedOutput,
  };
}
