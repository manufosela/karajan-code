// @ts-check
/**
 * Smoke test individual por proveedor.
 *
 * Uso:
 *   node scripts/smoke.js codex
 *   node scripts/smoke.js claude
 *   node scripts/smoke.js gemini
 *   node scripts/smoke.js ollama
 *
 * O vía pnpm:
 *   pnpm smoke:codex
 *   pnpm smoke:claude
 *   pnpm smoke:gemini
 *   pnpm smoke:ollama
 */

import { runCodexCli } from '../src/ai/adapters/codex-cli-adapter.js';
import { runClaudeCli } from '../src/ai/adapters/claude-cli-adapter.js';
import { runGeminiCli } from '../src/ai/adapters/gemini-cli-adapter.js';
import { runOllamaCli } from '../src/ai/adapters/ollama-cli-adapter.js';

/** @type {Record<string, (prompt: string, opts?: any) => Promise<unknown>>} */
const adapters = {
  codex: runCodexCli,
  claude: runClaudeCli,
  gemini: runGeminiCli,
  ollama: runOllamaCli,
};

const DEFAULT_PROMPT = 'Responde con un JSON que contenga la clave "answer" y el valor "pong".';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const provider = (argv[2] || '').toLowerCase();
  const prompt = argv[3] || DEFAULT_PROMPT;

  if (!adapters[provider]) {
    console.error(`[smoke] Proveedor inválido: "${provider}".`);
    console.error('[smoke] Usa uno de: codex, claude, gemini');
    process.exit(2);
  }

  console.log(`[smoke] Proveedor : ${provider}`);
  console.log(`[smoke] Prompt   : ${prompt}`);
  console.log(`[smoke] Timeout  : ${DEFAULT_TIMEOUT_MS} ms`);
  console.log('[smoke] Lanzando...\n');

  const start = Date.now();
  try {
    const result = await adapters[provider](prompt, { timeoutMs: DEFAULT_TIMEOUT_MS });
    const elapsed = Date.now() - start;

    console.log(`[smoke] Finalizado en ${elapsed} ms\n`);
    console.log('[smoke] Resultado normalizado:');
    console.dir(result, { depth: null });

    const proc = /** @type {any} */ (result).process;
    if (proc && proc.exitCode !== 0) {
      console.warn(
        `\n[smoke] Aviso: exitCode=${proc.exitCode} signal=${proc.signal} timedOut=${proc.timedOut}`,
      );
      process.exitCode = 1;
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[smoke] Error tras ${elapsed} ms:`, err);
    process.exitCode = 1;
  }
}

main(process.argv);
