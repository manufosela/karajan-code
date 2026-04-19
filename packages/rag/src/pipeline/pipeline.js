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
 */

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
 * @param {{ errorPolicy?: ErrorPolicy }} [options]
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

  stages.forEach(assertStage);

  /** @type {string[]} */
  const executedStages = [];
  let currentInput = /** @type {unknown} */ (initialInput);
  let finalOutput = null;
  let ok = true;

  for (const stage of stages) {
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

    ctx.logger.info(`Stage "${stage.name}" · start`);
    try {
       
      const output = await stage.run(currentInput, ctx);
      executedStages.push(stage.name);
      currentInput = output;
      finalOutput = output;
      ctx.logger.info(`Stage "${stage.name}" · done`);
    } catch (err) {
      const pErr = toPipelineError(stage.name, err);
      ctx.errors.push(pErr);
      ctx.logger.error(`Stage "${stage.name}" · error: ${pErr.message}`);
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
