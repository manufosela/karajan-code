// @ts-check
/**
 * Contratos tipados (JSDoc) del Pipeline Engine de Karajan RAG.
 *
 * Este módulo exporta solo @typedef — sin código en tiempo de ejecución.
 * Los consumidores lo importan con comentarios JSDoc:
 *   @typedef {import('./types.js').Stage} Stage
 *
 * Inspirado en `src/orchestrator/stages/stage-executor.js` de Karajan Code
 * (v2.5.0 @ 45fd0f2) — adaptado al dominio RAG (ver ADR-001).
 */

/**
 * @typedef {Object} Logger
 * @property {(msg: string, meta?: Record<string, unknown>) => void} info
 * @property {(msg: string, meta?: Record<string, unknown>) => void} warn
 * @property {(msg: string, meta?: Record<string, unknown>) => void} error
 * @property {(msg: string, meta?: Record<string, unknown>) => void} [debug]
 */

/**
 * Bolsa de herramientas inyectables a un Role o Stage (DI).
 * Cada key es un servicio resoluble por nombre; los consumidores piden
 * `tools.get('claude')` o `tools.get('embedder')`.
 *
 * @typedef {Object} ToolBox
 * @property {(name: string) => unknown} get Resuelve una herramienta por nombre o lanza si no existe.
 * @property {(name: string) => boolean} has Indica si la herramienta está registrada.
 */

/**
 * Estado del pipeline que se pasa por cada Stage.
 * Es mutable por diseño: los stages acumulan metadata y errores.
 *
 * @typedef {Object} PipelineContext
 * @property {Logger} logger Logger estructurado del pipeline.
 * @property {ToolBox} tools Herramientas disponibles (adapters, embedder, vector store…).
 * @property {Record<string, unknown>} metadata Metadata libre que los stages pueden leer/escribir.
 * @property {PipelineError[]} errors Errores no fatales acumulados (stage falla pero pipeline continúa).
 * @property {AbortSignal} [signal] Señal opcional para cancelación cooperativa.
 */

/**
 * Error normalizado de un stage.
 *
 * @typedef {Object} PipelineError
 * @property {string} stage Nombre del stage que falló.
 * @property {string} message Mensaje humano.
 * @property {unknown} [cause] Error original.
 * @property {string} isoDate Fecha ISO en que ocurrió.
 */

/**
 * Contrato mínimo de un Stage: toma un input, devuelve un output usando el contexto.
 * Los stages son la unidad de ejecución del Pipeline. Pueden ser funciones puras
 * (código determinista) o wrappers que delegan a un Role.
 *
 * @template TInput
 * @template TOutput
 * @typedef {Object} Stage
 * @property {string} name Identificador único dentro del pipeline.
 * @property {(input: TInput, ctx: PipelineContext) => Promise<TOutput> | TOutput} run
 * @property {(input: TInput, ctx: PipelineContext) => boolean | Promise<boolean>} [canRun]
 *   Hook opcional para saltarse el stage si la condición no se cumple.
 */

/**
 * Política de manejo de errores por stage.
 *
 * - `abort`: el pipeline se detiene en el primer error.
 * - `continue`: el error se acumula en `ctx.errors` y el pipeline sigue con el siguiente stage.
 *
 * @typedef {"abort" | "continue"} ErrorPolicy
 */

/**
 * Resultado final del pipeline tras ejecutar todos los stages.
 *
 * @template TFinalOutput
 * @typedef {Object} PipelineResult
 * @property {TFinalOutput | null} output Output del último stage (null si abortó antes).
 * @property {boolean} ok `true` si todos los stages ejecutados terminaron sin error.
 * @property {PipelineError[]} errors Errores acumulados durante la ejecución.
 * @property {string[]} executedStages Nombres de los stages que llegaron a ejecutarse.
 */

/**
 * Evento emitido al iniciar un stage.
 *
 * @typedef {Object} StageStartEvent
 * @property {string} stageName
 * @property {number} stageIndex Posición 0-based dentro del array de stages.
 * @property {number|undefined} inputSize Estimación del tamaño del input (ver `estimateSize`).
 */

/**
 * Evento emitido cuando un stage finaliza correctamente.
 *
 * @typedef {Object} StageEndEvent
 * @property {string} stageName
 * @property {number} stageIndex
 * @property {number} durationMs Duración del stage en milisegundos (performance.now diff).
 * @property {number|undefined} inputSize
 * @property {number|undefined} outputSize
 */

/**
 * Evento emitido cuando un stage lanza error.
 *
 * @typedef {Object} StageErrorEvent
 * @property {string} stageName
 * @property {number} stageIndex
 * @property {number} durationMs
 * @property {number|undefined} inputSize
 * @property {PipelineError} error Error ya normalizado por el pipeline.
 */

/**
 * Hooks opcionales de observabilidad del pipeline.
 * Todos los callbacks son invocados de forma síncrona *tras* el trabajo del
 * stage (salvo `onStageStart`, que se invoca antes). Si un hook lanza, el
 * error se captura silenciosamente y se registra en `ctx.logger.warn`: nunca
 * debe propagarse y romper el pipeline que observa.
 *
 * @typedef {Object} StageEventHooks
 * @property {(event: StageStartEvent) => void} [onStageStart]
 * @property {(event: StageEndEvent) => void} [onStageEnd]
 * @property {(event: StageErrorEvent) => void} [onStageError]
 */
