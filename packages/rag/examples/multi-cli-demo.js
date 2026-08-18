// @ts-check
import { runMultiCli } from '../src/ai/multi-cli-orchestrator.js';

/**
 * Minimal demo entrypoint: ejecuta un prompt contra los 3 CLIs configurados
 * y vuelca el resultado normalizado por consola.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const prompt = 'Resume en una frase qué es chunking en RAG';
  console.log(`[karajan-rag] Lanzando prompt a los proveedores...\nPrompt: ${prompt}\n`);

  const results = await runMultiCli(prompt);

  console.log('[karajan-rag] Resultados agregados:\n');
  console.dir(results, { depth: null });
}

main().catch((err) => {
  console.error('[karajan-rag] Error fatal en la demo:', err);
  process.exitCode = 1;
});
