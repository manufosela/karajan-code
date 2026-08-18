// @ts-check
/**
 * Smoke test individual por proveedor.
 *
 * IMPORTANTE: este script es opt-in y NO forma parte de la suite de
 * unit tests que ejecuta `pnpm test` ni la CI. Para ejecutarlo hay
 * que poner la variable de entorno RUN_SMOKE=1 explícitamente.
 *
 * Uso:
 *   RUN_SMOKE=1 node scripts/smoke.js codex
 *   RUN_SMOKE=1 node scripts/smoke.js claude
 *   RUN_SMOKE=1 node scripts/smoke.js gemini
 *   RUN_SMOKE=1 node scripts/smoke.js ollama
 *
 * O vía pnpm (los scripts de package.json ya exportan RUN_SMOKE=1):
 *   pnpm smoke:codex
 *   pnpm smoke:claude
 *   pnpm smoke:gemini
 *   pnpm smoke:ollama
 *
 * Motivo: los smoke tests hacen spawn real de los CLIs de cada proveedor
 * y dependen de credenciales locales. Ejecutarlos en CI provocaría fallos
 * falsos (binaries ausentes) o consumo innecesario de tokens.
 */

if (process.env.RUN_SMOKE !== '1') {
  console.error(
    '[smoke] Este script es opt-in. Exporta RUN_SMOKE=1 o usa los scripts\n' +
      '         `pnpm smoke:<provider>` (que ya lo exportan por ti).',
  );
  process.exit(2);
}

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
