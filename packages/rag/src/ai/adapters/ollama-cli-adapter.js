// @ts-check
import { runCli } from '../cli-runner.js';
import { parseCliOutput } from '../output-parser.js';

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [binary] Override del binario Ollama. Defaults a "ollama".
 * @property {string} [model] Modelo local a usar (p. ej. "llama3.2", "mistral",
 *   "qwen2.5", "deepseek-r1"). Defaults a "llama3.2" — ajustar según los
 *   modelos descargados localmente con `ollama pull`.
 * @property {string[]} [extraArgs] Flags adicionales antes del prompt.
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} [timeoutMs]
 * @property {typeof runCli} [runner]
 * @property {typeof parseCliOutput} [parser]
 */

// NOTA: Se usa `ollama run <model> "<prompt>"` en modo no-interactivo.
// Ollama CLI no tiene flag --json; el parser común detectará JSON embebido
// en la respuesta del modelo (el wrapper buildStrictJsonPrompt le pide que
// responda solo con JSON). Si una versión concreta cambia la CLI, ajustar
// buildOllamaArgs sin tocar el resto.

/**
 * Wrap del prompt pidiendo JSON estricto al modelo local.
 * Exportado para tests.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function buildStrictJsonPrompt(prompt) {
  return [
    'Responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional,',
    'sin bloques de código markdown y sin explicaciones. Esquema sugerido:',
    '{ "answer": string, "details"?: string }',
    '',
    'Prompt del usuario:',
    prompt,
  ].join('\n');
}

/**
 * Construye el argv para `ollama run`.
 *
 * @param {string} model
 * @param {string} wrappedPrompt
 * @param {string[]} [extraArgs]
 * @returns {string[]}
 */
function buildOllamaArgs(model, wrappedPrompt, extraArgs = []) {
  return ['run', model, ...extraArgs, wrappedPrompt];
}

/**
 * Ejecuta un prompt contra Ollama local y normaliza la salida.
 *
 * Ventaja clave: el prompt nunca sale de la máquina. Apto para datos
 * marcados como `confidential` (ver épica KJR-PCS-0011).
 *
 * @param {string} prompt
 * @param {AdapterOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runOllamaCli(prompt, options = {}) {
  const {
    binary = 'ollama',
    model = 'llama3.2',
    extraArgs,
    cwd,
    env,
    timeoutMs,
    runner = runCli,
    parser = parseCliOutput,
  } = options;

  const wrapped = buildStrictJsonPrompt(prompt);
  const args = buildOllamaArgs(model, wrapped, extraArgs);
  const processResult = await runner(binary, { args, cwd, env, timeoutMs });
  const parsedOutput = parser(processResult.stdout, processResult.stderr);

  return {
    provider: 'ollama',
    process: processResult,
    parsedOutput,
    providerMeta: { model },
  };
}
