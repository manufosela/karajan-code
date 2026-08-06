// @ts-check
/**
 * Capa Easy RAG — el camino guardado de respuesta, compartido por CLI,
 * SDK y servidor HTTP (KJR-TSK-0150). Una sola implementación de:
 *
 *   modo (rag/cag/hybrid) → contexto → nivel efectivo → policy →
 *   redacción PII → adapter
 *
 * para que ninguna superficie pueda divergir del gate.
 */
import { queryIndex } from './query.js';
import { buildCagContext, buildHybridContext } from './cag.js';
import { effectiveSensitivityOfHits, enforceEasyAdapterPolicy } from './sensitivity.js';
import { GeneratorRole } from '../generation/generator-role.js';
import { redactPII } from '../redaction/pii-redactor.js';
import { createDefaultAdapterRegistry } from '../ai/adapter-registry.js';
import { createOllamaClient } from '../ai/adapters/ollama-client.js';

/**
 * Registry para respuestas de la capa easy: los CLIs públicos por defecto
 * más ollama (HTTP local), el único provider permitido para confidential —
 * sin él, ningún corpus restrictivo tendría salida.
 *
 * @returns {Promise<import('../ai/adapter-registry.js').AdapterRegistry>}
 */
export async function createEasyAnswerRegistry() {
  const registry = await createDefaultAdapterRegistry();
  if (!registry.has('ollama')) {
    registry.register('ollama', createOllamaClient().adapter, { transport: 'http' });
  }
  return registry;
}

/**
 * Genera la respuesta LLM para hits ya recuperados aplicando el fix de
 * KJR-BUG-0006 (ADR-005 §6): el nivel efectivo es el MÁXIMO de los chunks
 * recuperados, el adapter se valida contra la sensitivity policy y todo
 * el contenido sale redactado de PII (defensa en profundidad).
 *
 * @param {{
 *   question: string,
 *   hits: import('./query.js').EasyQueryHit[],
 *   adapter: string,
 *   adapterExplicit?: boolean,
 *   registry?: { get: (name: string) => unknown, has: (name: string) => boolean },
 *   log?: (msg: string) => void,
 * }} params
 * @returns {Promise<{ answer: string, adapter: string, sensitivity: import('../domain/document.js').Sensitivity }>}
 */
export async function generateAnswerForHits(params) {
  const { question, hits, adapterExplicit = false } = params;
  const log = params.log ?? ((msg) => console.error(`[query] ${msg}`));
  const sensitivity = effectiveSensitivityOfHits(hits);
  const adapter = enforceEasyAdapterPolicy({
    sensitivity,
    adapter: params.adapter,
    explicit: adapterExplicit,
    log,
  });
  const registry = params.registry ?? (await createEasyAnswerRegistry());
  const generator = new GeneratorRole({
    name: 'easy-query-generator',
    logger: { info: log, warn: log, error: log },
    adapterName: adapter,
  });
  const generated = await generator.run(
    {
      query: redactPII(question).text,
      contextChunks: hits.map((h) => ({
        id: h.id,
        score: h.score,
        metadata: { content: redactPII(h.content).text, source: h.source },
      })),
    },
    {
      get: (name) => registry.get(name),
      has: (name) => registry.has(name),
    },
  );
  return { answer: generated.answer, adapter, sensitivity };
}

/**
 * @typedef {object} AnswerWithModeOptions
 * @property {'rag' | 'cag' | 'hybrid'} [mode] Default 'rag'.
 * @property {string} [adapter] Default 'claude' (la policy decide).
 * @property {boolean} [adapterExplicit] true = elección explícita: no permitido → error.
 * @property {{ get: (name: string) => unknown, has: (name: string) => boolean }} [registry]
 * @property {number} [topK] Solo rag/hybrid.
 * @property {number} [maxContextChars] Solo cag/hybrid.
 * @property {(msg: string) => void} [log]
 *
 * @typedef {object} AnswerWithModeResult
 * @property {string} answer
 * @property {string} adapter Adapter realmente usado tras la policy.
 * @property {import('../domain/document.js').Sensitivity} sensitivity Nivel efectivo del contexto.
 * @property {'rag' | 'cag' | 'hybrid'} mode
 * @property {string[]} [files] Ficheros del contexto (cag/hybrid).
 * @property {{ source: string, chars: number }[]} [excluded] Excluidos por presupuesto (hybrid).
 */

/**
 * Respuesta LLM con el modo elegido sobre un índice abierto — la única
 * implementación que comparten SDK, servicio HTTP y (vía sus propios
 * caminos equivalentes) el CLI.
 *
 * @param {{ rootDir: string, store: { search: Function }, embedder: import('./indexer.js').EasyEmbedder, question: string } & AnswerWithModeOptions} params
 * @returns {Promise<AnswerWithModeResult>}
 */
export async function answerWithMode(params) {
  const { rootDir, store, embedder, question } = params;
  const mode = params.mode ?? 'rag';
  if (!['rag', 'cag', 'hybrid'].includes(mode)) {
    throw Object.assign(
      new Error(`answer: "mode" debe ser rag, cag o hybrid (recibido: "${mode}").`),
      { statusCode: 400 },
    );
  }
  const log = params.log ?? (() => {});

  /** @type {import('./query.js').EasyQueryHit[]} */
  let hits;
  /** @type {string[] | undefined} */
  let files;
  /** @type {{ source: string, chars: number }[] | undefined} */
  let excluded;

  if (mode === 'cag') {
    const ctx = await buildCagContext(rootDir, { maxChars: params.maxContextChars });
    hits = ctx.hits;
    files = ctx.files;
  } else {
    const retrieved = await queryIndex(question, {
      rootDir,
      store: /** @type {never} */ (store),
      embedder,
      topK: params.topK ?? 5,
    });
    if (retrieved.hits.length === 0) {
      throw Object.assign(
        new Error('answer: la consulta no recuperó nada del índice.'),
        { statusCode: 404 },
      );
    }
    if (mode === 'hybrid') {
      const ctx = await buildHybridContext(rootDir, {
        hits: retrieved.hits,
        maxChars: params.maxContextChars,
      });
      hits = ctx.hits;
      files = ctx.files;
      excluded = ctx.excluded;
    } else {
      hits = retrieved.hits;
    }
  }

  const generated = await generateAnswerForHits({
    question,
    hits,
    adapter: params.adapter ?? 'claude',
    adapterExplicit: params.adapterExplicit ?? false,
    registry: params.registry,
    log,
  });
  return {
    answer: generated.answer,
    adapter: generated.adapter,
    sensitivity: generated.sensitivity,
    mode,
    ...(files ? { files } : {}),
    ...(excluded ? { excluded } : {}),
  };
}
