// @ts-check
import { runCli } from '../cli-runner.js';
import { parseCliOutput } from '../output-parser.js';

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [binary] Override the Gemini CLI binary name/path. Defaults to "gemini".
 * @property {string[]} [extraArgs] Additional flags prepended before the prompt.
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} [timeoutMs]
 * @property {typeof runCli} [runner] Inyección de dependencia para facilitar tests.
 * @property {typeof parseCliOutput} [parser]
 */

// NOTA: Flags de Gemini CLI dependen de versión. Se asume modo no interactivo con
// `-p` (prompt). Ajustar `buildGeminiArgs` si la versión instalada difiere.

/**
 * Wrap the user prompt asking Gemini to answer in strict JSON only.
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
 * Build the argv array passed to the Gemini CLI.
 * @param {string} wrappedPrompt
 * @param {string[]} [extraArgs]
 * @returns {string[]}
 */
function buildGeminiArgs(wrappedPrompt, extraArgs = []) {
  return ['-p', ...extraArgs, wrappedPrompt];
}

/**
 * Run a prompt against the Gemini CLI and normalize its output.
 *
 * @param {string} prompt User-level prompt (will be wrapped to request strict JSON).
 * @param {AdapterOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runGeminiCli(prompt, options = {}) {
  const {
    binary = 'gemini',
    extraArgs,
    cwd,
    env,
    timeoutMs,
    runner = runCli,
    parser = parseCliOutput,
  } = options;

  const wrapped = buildStrictJsonPrompt(prompt);
  const args = buildGeminiArgs(wrapped, extraArgs);
  const processResult = await runner(binary, { args, cwd, env, timeoutMs });
  const parsedOutput = parser(processResult.stdout, processResult.stderr);

  return {
    provider: 'gemini',
    process: processResult,
    parsedOutput,
  };
}
