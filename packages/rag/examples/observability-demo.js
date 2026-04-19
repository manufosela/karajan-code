// @ts-check
/**
 * Demo de observabilidad del pipeline.
 *
 * Ejecuta un pipeline de 3 stages (uppercase → split → count) con los hooks
 * onStageStart / onStageEnd / onStageError. Captura cada evento en un array
 * y al final imprime una tabla con el tiempo y tamaño de cada stage.
 *
 * Uso:
 *   node examples/observability-demo.js
 */

import { runPipeline, createPipelineContext } from '../src/pipeline/pipeline.js';
import { collectPipelineEvents } from '../src/pipeline/collect-events.js';

/**
 * Logger de consola coloreado "lite" (sin dependencias).
 * @returns {import('../src/pipeline/types.js').Logger}
 */
function consoleLogger() {
  return {
    info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ''),
    warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ''),
    error: (msg, meta) => console.error(`[err ] ${msg}`, meta ?? ''),
    debug: () => {},
  };
}

function emptyTools() {
  return {
    get: (name) => { throw new Error(`Tool "${name}" no registrado`); },
    has: () => false,
  };
}

async function main() {
  const stages = [
    { name: 'uppercase', run: (text) => String(text).toUpperCase() },
    { name: 'split',     run: (text) => text.split(/\s+/).filter(Boolean) },
    { name: 'count',     run: (words) => ({ total: words.length, preview: words.slice(0, 5) }) },
  ];

  const ctx = createPipelineContext({ logger: consoleLogger(), tools: emptyTools() });

  // collectPipelineEvents() devuelve { events, hooks }:
  // - hooks se pasa a runPipeline.
  // - events se rellena vivo con cada start/end/error.
  const { events, hooks } = collectPipelineEvents();

  const result = await runPipeline(
    stages,
    'Karajan RAG orquesta pipelines con roles conmutables.',
    ctx,
    { events: hooks },
  );

  console.log('\n=== Resultado pipeline ===');
  console.log('ok:', result.ok);
  console.log('output:', result.output);
  console.log('executedStages:', result.executedStages.join(' → '));

  console.log('\n=== Telemetría por stage ===');
  console.table(events.map((e) => ({
    kind: e.kind,
    stage: e.stageName,
    inputSize: e.inputSize,
    outputSize: 'outputSize' in e ? e.outputSize : undefined,
    durationMs: 'durationMs' in e ? round(e.durationMs) : undefined,
    error: 'error' in e ? e.error.message : undefined,
  })));
}

/**
 * @param {number} ms
 * @returns {number}
 */
function round(ms) {
  return Math.round(ms * 100) / 100;
}

main().catch((err) => {
  console.error('Demo falló:', err);
  process.exit(1);
});
