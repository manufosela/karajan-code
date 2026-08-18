// @ts-check
/**
 * @typedef {import('./types.js').StageStartEvent} StageStartEvent
 * @typedef {import('./types.js').StageEndEvent} StageEndEvent
 * @typedef {import('./types.js').StageErrorEvent} StageErrorEvent
 * @typedef {import('./types.js').StageEventHooks} StageEventHooks
 */

/**
 * @typedef {(
 *   | (StageStartEvent & { kind: 'start' })
 *   | (StageEndEvent   & { kind: 'end' })
 *   | (StageErrorEvent & { kind: 'error' })
 * )} CollectedStageEvent
 */

/**
 * @typedef {Object} CollectPipelineEventsResult
 * @property {CollectedStageEvent[]} events Array mutable que recibe los eventos conforme el pipeline los emite.
 * @property {StageEventHooks} hooks Objeto listo para pasar como `options.events` de runPipeline.
 */

/**
 * Helper para capturar todos los eventos del pipeline en un array sin
 * escribir tres callbacks repetidos. Cada entrada lleva un campo `kind`
 * ("start" | "end" | "error") además de los campos del evento original.
 *
 * Uso:
 *   const { events, hooks } = collectPipelineEvents();
 *   await runPipeline(stages, input, ctx, { events: hooks });
 *   console.log(events); // [{kind: 'start', stageName: …}, …]
 *
 * @returns {CollectPipelineEventsResult}
 */
export function collectPipelineEvents() {
  /** @type {CollectedStageEvent[]} */
  const events = [];
  const hooks = {
    onStageStart: (e) => { events.push({ kind: 'start', ...e }); },
    onStageEnd:   (e) => { events.push({ kind: 'end',   ...e }); },
    onStageError: (e) => { events.push({ kind: 'error', ...e }); },
  };
  return { events, hooks };
}
