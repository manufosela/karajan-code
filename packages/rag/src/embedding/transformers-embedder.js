// @ts-check

/**
 * @typedef {import('./embedder.js').Embedder} Embedder
 */

/**
 * @typedef {Object} TransformersEmbedderOptions
 * @property {string} [model] Nombre de modelo del hub (default 'Xenova/all-MiniLM-L6-v2').
 * @property {number} [dimensions] Dimensión esperada (default 384 — all-MiniLM-L6-v2).
 * @property {(name: string, model: string) => Promise<any>} [loader] Override para tests; por defecto carga @xenova/transformers.
 */

/**
 * Construye un Embedder basado en @xenova/transformers (ONNX runtime puro JS,
 * sin deps nativas). Descarga el modelo del Hub en el primer uso y lo cachea.
 *
 * Para mantener el repo ligero, `@xenova/transformers` se trata como
 * **peer dependency opcional**: si no está instalada, el constructor lanza
 * con instrucción de instalación. Se inyecta `loader` en tests para
 * evitar descarga real.
 *
 * Uso real:
 *   pnpm add @xenova/transformers
 *   const e = createTransformersEmbedder(); // Xenova/all-MiniLM-L6-v2 (384)
 *   const v = await e.embed('hola');
 *
 * @param {TransformersEmbedderOptions} [options]
 * @returns {Embedder}
 */
export function createTransformersEmbedder(options = {}) {
  const model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
  const dimensions = options.dimensions ?? 384;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('createTransformersEmbedder: "dimensions" debe ser entero positivo.');
  }
  const loader = options.loader ?? defaultLoader;
  /** @type {Promise<any> | null} */
  let pipelinePromise = null;

  async function ensurePipeline() {
    if (!pipelinePromise) pipelinePromise = loader('feature-extraction', model);
    return pipelinePromise;
  }

  /**
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async function embed(text) {
    const pipeline = await ensurePipeline();
    const out = await pipeline(String(text ?? ''), { pooling: 'mean', normalize: true });
    const vector = Array.isArray(out) ? out : Array.from(out.data ?? out);
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      throw new Error(
        `TransformersEmbedder: dimensión devuelta ${vector?.length ?? 'n/a'} != esperada ${dimensions}.`,
      );
    }
    return vector;
  }

  return {
    dimensions,
    embed,
    async embedBatch(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      return Promise.all(texts.map((t) => embed(t)));
    },
  };
}

/**
 * Loader por defecto. Intenta import('@xenova/transformers') y devuelve
 * el pipeline de feature-extraction. Si la dep no está instalada, lanza
 * con mensaje instructivo.
 *
 * @param {string} task
 * @param {string} model
 * @returns {Promise<any>}
 */
async function defaultLoader(task, model) {
  try {
    const mod = await import('@xenova/transformers');
    if (typeof mod.pipeline !== 'function') {
      throw new Error('@xenova/transformers: export "pipeline" no encontrado.');
    }
    return mod.pipeline(task, model);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot find package')) {
      throw new Error(
        "TransformersEmbedder requiere '@xenova/transformers'. Instala con: pnpm add @xenova/transformers",
        { cause: err },
      );
    }
    throw err;
  }
}
