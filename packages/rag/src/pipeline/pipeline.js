// @ts-check
// Pipeline Engine de Karajan RAG.
//
// Inspirado en karajan-code@45fd0f2 src/orchestrator/flow-runner.js:
//   KJR se queda con la idea de "lista de stages ejecutada secuencialmente
//   con contexto compartido", pero simplifica el diseño para el dominio
//   RAG: sin checkpoints, sin journaling, sin resume. Esto se añadirá
//   cuando el tamaño de los pipelines RAG lo justifique (ver roadmap).
//
// KJR-TSK-0002 · Licencia AGPL-3.0-or-later (ver ADR-001).

/**
 * @typedef {import('./types.js').Stage<any, any>} Stage
 * @typedef {import('./types.js').PipelineContext} PipelineContext
 * @typedef {import('./types.js').PipelineError} PipelineError
 * @typedef {import('./types.js').ErrorPolicy} ErrorPolicy
 * @typedef {import('./types.js').PipelineResult<any>} PipelineResult
 * @typedef {import('./types.js').StageEventHooks} StageEventHooks
 */

/**
 * Estimación defensiva del tamaño de un valor para telemetría.
 * No pretende ser exacta: es una señal aproximada (número de elementos,
 * caracteres, bytes según tipo). Si el tipo es desconocido, devuelve undefined
 * en vez de lanzar.
 *
 * @param {unknown} value
 * @returns {number|undefined}
 */
export function estimateSize(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return 1;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) {
    return /** @type {ArrayBufferView} */ (value).byteLength;
  }
  if (typeof value === 'object') return Object.keys(value).length;
  return undefined;
}

/**
 * Invoca un hook de observabilidad capturando cualquier excepción, para que
 * los observadores no puedan romper el pipeline.
 *
 * @template T
 * @param {((event: T) => void) | undefined} hook
 * @param {T} event
 * @param {PipelineContext} ctx
 * @param {string} label
 */
function safeInvoke(hook, event, ctx, label) {
  if (typeof hook !== 'function') return;
  try {
    hook(event);
  } catch (err) {
    ctx.logger.warn(`Hook "${label}" lanzó error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Convierte cualquier valor lanzado en un `PipelineError` normalizado.
 *
 * @param {string} stageName
 * @param {unknown} cause
 * @returns {PipelineError}
 */
function toPipelineError(stageName, cause) {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : `Stage "${stageName}" lanzó un error no-Error`;
  return {
    stage: stageName,
    message,
    cause,
    isoDate: new Date().toISOString(),
  };
}

/**
 * Determina si el stage debe ejecutarse (respeta `canRun` opcional).
 *
 * @param {Stage} stage
 * @param {unknown} input
 * @param {PipelineContext} ctx
 * @returns {Promise<boolean>}
 */
async function shouldRun(stage, input, ctx) {
  if (typeof stage.canRun !== 'function') return true;
  try {
    return await stage.canRun(input, ctx);
  } catch (err) {
    ctx.logger.warn(`Stage "${stage.name}": canRun lanzó error, se asume false`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Valida mínimamente un stage antes de ejecutar.
 *
 * @param {unknown} stage
 * @param {number} index
 * @returns {asserts stage is Stage}
 */
function assertStage(stage, index) {
  if (!stage || typeof stage !== 'object') {
    throw new Error(`Pipeline: stage en posición ${index} no es un objeto válido.`);
  }
  const s = /** @type {Partial<Stage>} */ (stage);
  if (typeof s.name !== 'string' || s.name.length === 0) {
    throw new Error(`Pipeline: stage en posición ${index} no tiene "name".`);
  }
  if (typeof s.run !== 'function') {
    throw new Error(`Pipeline: stage "${s.name}" no tiene método "run".`);
  }
}

/**
 * Ejecuta una lista de stages secuencialmente, propagando la salida de cada
 * uno como entrada del siguiente. El `ctx` es mutable y se comparte entre stages.
 *
 * Política de errores:
 *   - `abort` (default): el primer error detiene el pipeline.
 *   - `continue`: el error se acumula en `ctx.errors` y el pipeline sigue,
 *     pasando al siguiente stage el MISMO input que tenía el stage fallido
 *     (no hay output válido con que avanzar).
 *
 * @template TInput, TOutput
 * @param {Stage[]} stages
 * @param {TInput} initialInput
 * @param {PipelineContext} ctx
 * @param {{ errorPolicy?: ErrorPolicy, events?: StageEventHooks }} [options]
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(stages, initialInput, ctx, options = {}) {
  if (!Array.isArray(stages)) {
    throw new Error('runPipeline: "stages" debe ser un array.');
  }
  if (!ctx || !ctx.logger || !ctx.tools || !Array.isArray(ctx.errors)) {
    throw new Error('runPipeline: "ctx" inválido (faltan logger/tools/errors).');
  }
  const errorPolicy = options.errorPolicy ?? 'abort';
  const events = options.events ?? {};

  stages.forEach(assertStage);

  /** @type {string[]} */
  const executedStages = [];
  let currentInput = /** @type {unknown} */ (initialInput);
  let finalOutput = null;
  let ok = true;

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stage = stages[stageIndex];
    if (ctx.signal && ctx.signal.aborted) {
      ctx.logger.warn(`Pipeline abortado por signal antes de stage "${stage.name}".`);
      ok = false;
      break;
    }


    const canRun = await shouldRun(stage, currentInput, ctx);
    if (!canRun) {
      ctx.logger.info(`Stage "${stage.name}" saltado (canRun=false).`);
      continue;
    }

    const inputSize = estimateSize(currentInput);
    safeInvoke(events.onStageStart, { stageName: stage.name, stageIndex, inputSize }, ctx, 'onStageStart');
    ctx.logger.info(`Stage "${stage.name}" · start`);
    const startedAt = performance.now();
    try {

      const output = await stage.run(currentInput, ctx);
      const durationMs = performance.now() - startedAt;
      executedStages.push(stage.name);
      currentInput = output;
      finalOutput = output;
      const outputSize = estimateSize(output);
      ctx.logger.info(`Stage "${stage.name}" · done`);
      safeInvoke(
        events.onStageEnd,
        { stageName: stage.name, stageIndex, durationMs, inputSize, outputSize },
        ctx,
        'onStageEnd',
      );
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      const pErr = toPipelineError(stage.name, err);
      ctx.errors.push(pErr);
      ctx.logger.error(`Stage "${stage.name}" · error: ${pErr.message}`);
      safeInvoke(
        events.onStageError,
        { stageName: stage.name, stageIndex, durationMs, inputSize, error: pErr },
        ctx,
        'onStageError',
      );
      ok = false;
      if (errorPolicy === 'abort') break;
      // 'continue': mantenemos currentInput para el próximo stage.
      executedStages.push(stage.name);
    }
  }

  return {
    output: ok ? finalOutput : finalOutput,
    ok,
    errors: [...ctx.errors],
    executedStages,
  };
}

/**
 * Helper para construir un `PipelineContext` mínimo.
 * Útil en tests y scripts; en producción normalmente se compone manualmente
 * con logger estructurado real y ToolBox con adapters.
 *
 * @param {{ logger: import('./types.js').Logger, tools: import('./types.js').ToolBox, metadata?: Record<string, unknown>, signal?: AbortSignal }} parts
 * @returns {PipelineContext}
 */
export function createPipelineContext(parts) {
  if (!parts || !parts.logger || !parts.tools) {
    throw new Error('createPipelineContext: se requieren "logger" y "tools".');
  }
  return {
    logger: parts.logger,
    tools: parts.tools,
    metadata: parts.metadata ?? {},
    errors: [],
    signal: parts.signal,
  };
}
