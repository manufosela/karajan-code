// @ts-check
import { runCodexCli } from './adapters/codex-cli-adapter.js';
import { runClaudeCli } from './adapters/claude-cli-adapter.js';
import { runGeminiCli } from './adapters/gemini-cli-adapter.js';

/**
 * @typedef {"codex" | "claude" | "gemini"} ProviderName
 */

/**
 * @typedef {Object} ProviderErrorResult
 * @property {ProviderName} provider
 * @property {string} error Human-readable error message in Spanish.
 */

/**
 * @typedef {Object} OrchestratorOptions
 * @property {(prompt: string) => Promise<unknown>} [codexAdapter]
 * @property {(prompt: string) => Promise<unknown>} [claudeAdapter]
 * @property {(prompt: string) => Promise<unknown>} [geminiAdapter]
 */

/**
 * Convert a rejected promise into a normalized provider error object.
 * @param {ProviderName} provider
 * @param {unknown} reason
 * @returns {ProviderErrorResult}
 */
function buildErrorResult(provider, reason) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Error desconocido al ejecutar el proveedor';
  return { provider, error: message };
}

/**
 * Execute the same prompt against all configured CLI providers in parallel.
 * Uses Promise.allSettled so that a single provider failure does not break the batch.
 *
 * @param {string} prompt
 * @param {OrchestratorOptions} [options] Inyección de dependencias (útil para tests).
 * @returns {Promise<Array<unknown | ProviderErrorResult>>}
 */
export async function runMultiCli(prompt, options = {}) {
  const {
    codexAdapter = runCodexCli,
    claudeAdapter = runClaudeCli,
    geminiAdapter = runGeminiCli,
  } = options;

  /** @type {Array<{ name: ProviderName, call: () => Promise<unknown> }>} */
  const jobs = [
    { name: 'codex', call: () => codexAdapter(prompt) },
    { name: 'claude', call: () => claudeAdapter(prompt) },
    { name: 'gemini', call: () => geminiAdapter(prompt) },
  ];

  const settled = await Promise.allSettled(jobs.map((job) => job.call()));

  return settled.map((outcome, index) => {
    const providerName = jobs[index].name;
    if (outcome.status === 'fulfilled') return outcome.value;
    return buildErrorResult(providerName, outcome.reason);
  });
}
