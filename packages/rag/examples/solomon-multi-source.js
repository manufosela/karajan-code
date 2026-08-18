// @ts-check
/**
 * Demo end-to-end multi-source de Karajan RAG.
 *
 * Orquesta los tres building blocks introducidos en Sprint 2:
 *
 *   1. `parallelRetrieve` paraleliza los retrievers por source con Promise.allSettled
 *      y timeout individual.
 *   2. `SolomonRole` (strategy: 'weighted') arbitra los resultados aplicando pesos
 *      por fuente. La decisión queda en ctx.metadata.solomonDecision.
 *   3. `GeneratorRole.streamGenerate()` produce la respuesta token a token
 *      usando un streamAdapter simulado (word-by-word con delay).
 *
 * Sin dependencias externas; los "retrievers" son closures en memoria con
 * datos dummy para que el script corra offline.
 *
 *   node examples/solomon-multi-source.js
 */

import { parallelRetrieve } from '../src/retrieval/parallel-retrieve.js';
import { SolomonRole } from '../src/retrieval/solomon-role.js';
import { GeneratorRole } from '../src/generation/generator-role.js';

/** @returns {import('../src/pipeline/types.js').Logger} */
function consoleLogger() {
  return {
    info: (msg) => console.log(`[info] ${msg}`),
    warn: (msg) => console.warn(`[warn] ${msg}`),
    error: (msg) => console.error(`[err ] ${msg}`),
    debug: () => {},
  };
}

function hit(id, score, content) {
  return { id, score, vector: [0], metadata: { id, content, index: 0 } };
}

// ---- Datos dummy ---------------------------------------------------------

const DOCS_CORPUS = [
  hit('docs-1', 0.92, 'Karajan RAG orquesta CLIs de IA con política de sensibilidad configurable.'),
  hit('docs-2', 0.81, 'El pipeline es una cadena de stages con hooks de observabilidad.'),
];

const POLICY_CORPUS = [
  hit('policy-1', 0.78, 'Datos con sensibilidad confidencial solo pueden enrutarse a Ollama on-premise.'),
  hit('docs-1', 0.70, 'Ver guía de política de sensibilidad en README.'),
];

const CHAT_CORPUS = [
  hit('chat-1', 0.65, 'El usuario preguntó la semana pasada por la política de datos.'),
];

/**
 * Simula un retriever con latencia variable.
 * @param {typeof DOCS_CORPUS} corpus
 * @param {number} latencyMs
 */
function makeRetriever(corpus, latencyMs) {
  return async (query) => {
    await new Promise((r) => setTimeout(r, latencyMs));
    // Retorno ingenuo: match por cualquier palabra de la query con >=3 caracteres.
    // Proxy de relevancia que basta para la demo; un retriever real usaría
    // embeddings o BM25.
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    return corpus.filter((h) => {
      const content = String(h.metadata.content).toLowerCase();
      return words.some((w) => content.includes(w));
    });
  };
}

/**
 * StreamAdapter simulado que emite el prompt resumido palabra a palabra.
 * Un adapter real llamaría al CLI/HTTP del proveedor con streaming.
 */
async function* fakeStreamAdapter(prompt) {
  const reply = `Resumen multi-source: ${prompt.slice(0, 80)}… [sintetizado]`;
  for (const word of reply.split(' ')) {
    await new Promise((r) => setTimeout(r, 15));
    yield `${word} `;
  }
}

// ---- Demo ----------------------------------------------------------------

async function main() {
  const query = 'política de sensibilidad';

  console.log(`\n=== Query: "${query}" ===\n`);

  // 1) Paraleliza retrievers (con timeout defensivo).
  const sourceResults = await parallelRetrieve(
    [
      { source: 'docs',   retrieve: makeRetriever(DOCS_CORPUS, 5) },
      { source: 'policy', retrieve: makeRetriever(POLICY_CORPUS, 10) },
      { source: 'chat',   retrieve: makeRetriever(CHAT_CORPUS, 8) },
    ],
    query,
    { timeoutMs: 200, logger: consoleLogger() },
  );

  console.log('--- Retrievals por source ---');
  for (const sr of sourceResults) {
    console.log(`  [${sr.source}] ${sr.hits.length} hits: ${sr.hits.map((h) => h.id).join(', ')}`);
  }

  // 2) Solomon arbitra con pesos: policy vale más que chat.
  const solomon = new SolomonRole({
    name: 'solomon',
    logger: consoleLogger(),
    strategy: 'weighted',
    sourceWeights: { policy: 2.0, docs: 1.5, chat: 0.5 },
  });
  const ctx = {
    logger: consoleLogger(),
    tools: { get: () => { throw new Error('n/a'); }, has: () => false },
    metadata: {},
    errors: [],
  };
  const verdict = await solomon.run({ query, sourceResults, maxChunks: 3 }, ctx);

  console.log('\n--- Verdict Solomon ---');
  console.log(`  strategy:     ${verdict.strategy}`);
  console.log(`  rationale:    ${verdict.rationale}`);
  console.log('  weights:     ', verdict.sourceWeights);
  console.log(`  top chunks:   ${verdict.chunks.map((c) => `${c.id}(${c.score.toFixed(3)})`).join(', ')}`);
  console.log(`  decision log:`, ctx.metadata.solomonDecision);

  // 3) Generator en modo streaming sobre los chunks elegidos.
  const generator = new GeneratorRole({
    name: 'generator',
    logger: consoleLogger(),
    streamAdapter: fakeStreamAdapter,
    forceCitation: true,
  });

  console.log('\n--- Answer (streaming) ---');
  process.stdout.write('  ');
  for await (const chunk of generator.streamGenerate({ query, contextChunks: verdict.chunks }, ctx.tools)) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

main().catch((err) => {
  console.error('Demo falló:', err);
  process.exit(1);
});
