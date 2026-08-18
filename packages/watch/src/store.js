// @ts-check
/**
 * Preparación del store del corpus (KJW-TSK-0022).
 *
 * El motor no crea su esquema: `karajan-rag` trae una migración SQL, pero
 * declara `vector(768)` mientras su capa Easy indexa con 256 (hash) o 384
 * (transformers), así que seguirla al pie de la letra revienta el INSERT.
 * Hasta ahora el esquema bueno solo existía dentro de `scripts/smoke.sh`:
 * quien declaraba `store: pgvector` en su config no tenía forma de saberlo.
 *
 * Aquí vive esa responsabilidad, aislada a propósito en un módulo propio:
 * el día que el motor sepa preparar su store (KJR-PRP-0008), esto delega y
 * desaparece sin tocar el resto del pipeline.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Dimensión del vector de cada embedder, tal y como los crea el motor. */
export const EMBEDDER_DIMENSIONS = Object.freeze({ hash: 256, transformers: 384 });

/** Tabla del corpus. El nombre es fijo en karajan-rag (gap KJR-PRP-0003). */
export const CORPUS_TABLE = 'karajan_rag_chunks';

/** Error de preparación del store, siempre con el dato que lo explica. */
export class StoreError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'StoreError';
  }
}

/**
 * Dimensión que corresponde a un embedder.
 *
 * @param {string} embedder
 * @returns {number}
 */
export const dimensionsFor = (embedder) => {
  const dimensions = EMBEDDER_DIMENSIONS[/** @type {never} */ (embedder)];
  if (!Number.isInteger(dimensions)) {
    throw new StoreError(
      `embedder desconocido: "${embedder}". Conocidos: ` +
        `${Object.keys(EMBEDDER_DIMENSIONS).join(', ')}.`,
    );
  }
  return dimensions;
};

/** SQL que prepara el esquema, con la dimensión ya resuelta. */
const schemaStatements = (dimensions) => [
  'CREATE EXTENSION IF NOT EXISTS vector;',
  // La dimensión se interpola porque un DDL no admite parámetros. No es
  // entrada libre: sale de EMBEDDER_DIMENSIONS y se valida como entero.
  `CREATE TABLE IF NOT EXISTS ${CORPUS_TABLE} (
     id          text PRIMARY KEY,
     source      text,
     chunk_index integer,
     content     text,
     embedding   vector(${dimensions}),
     metadata    jsonb DEFAULT '{}'::jsonb,
     created_at  timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS ${CORPUS_TABLE}_embedding_hnsw
     ON ${CORPUS_TABLE} USING hnsw (embedding vector_cosine_ops);`,
  `CREATE INDEX IF NOT EXISTS ${CORPUS_TABLE}_source_idx
     ON ${CORPUS_TABLE} (source);`,
  `CREATE INDEX IF NOT EXISTS ${CORPUS_TABLE}_metadata_gin
     ON ${CORPUS_TABLE} USING gin (metadata jsonb_path_ops);`,
];

/** Tipo declarado de la columna de embeddings, o null si no hay tabla. */
const EMBEDDING_TYPE_SQL = `
  SELECT format_type(a.atttypid, a.atttypmod) AS type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = '${CORPUS_TABLE}'
    AND a.attname = 'embedding'
    AND a.attnum > 0
    AND NOT a.attisdropped;`;

/**
 * Cliente `pg` real. Es un peer opcional: si no está, se dice cuál instalar
 * en vez de morir con un ERR_MODULE_NOT_FOUND críptico.
 *
 * @param {string} connectionString
 */
const defaultCreateClient = (connectionString) => {
  // Se busca desde este módulo Y desde el proyecto que nos ejecuta. Con pnpm
  // el paquete vive en un árbol enlazado (.pnpm/…) desde el que NO se alcanza
  // el `pg` del proyecto subiendo por node_modules, así que resolver solo
  // desde import.meta.url fallaría en una instalación perfectamente correcta.
  const candidates = [import.meta.url, pathToFileURL(join(process.cwd(), 'noop.js')).href];
  /** @type {unknown} */
  let lastError;
  for (const from of candidates) {
    try {
      const pg = createRequire(from)('pg');
      return new pg.Client({ connectionString });
    } catch (err) {
      lastError = err;
    }
  }
  throw new StoreError(
    'el store pgvector necesita el paquete "pg". Instálalo junto a ' +
      'karajan-watch: npm install pg',
    { cause: lastError },
  );
};

/**
 * @typedef {Object} PrepareResult
 * @property {boolean} prepared
 * @property {string} [reason] Por qué no hizo falta preparar nada.
 * @property {number} [dimensions]
 * @property {boolean} [alreadyExisted]
 */

/**
 * Deja el store listo para indexar. Idempotente: sobre un corpus ya
 * preparado no borra ni recrea nada.
 *
 * @param {Object} params
 * @param {{store: string, embedder: string}} params.corpus Entrada `corpus.code` o `corpus.docs` del config.
 * @param {string} [params.connectionString]
 * @param {{createClient?: (connectionString: string) => any}} [params.deps]
 * @returns {Promise<PrepareResult>}
 */
export const prepareStore = async ({ corpus, connectionString, deps = {} }) => {
  if (corpus.store !== 'pgvector') {
    return {
      prepared: false,
      reason:
        corpus.store === 'lancedb'
          ? 'lancedb guarda el corpus en ficheros: no hay esquema que preparar.'
          : 'el store en memoria no persiste nada: no hay esquema que preparar.',
    };
  }
  if (!connectionString) {
    throw new StoreError(
      'el store pgvector necesita una cadena de conexión (PG_URL): no hay ' +
        'nada que preparar sin saber contra qué base.',
    );
  }

  const dimensions = dimensionsFor(corpus.embedder);
  const client = (deps.createClient ?? defaultCreateClient)(connectionString);

  await client.connect();
  try {
    const existing = await client.query(EMBEDDING_TYPE_SQL);
    const declaredType = existing.rows?.[0]?.type ?? null;

    if (declaredType) {
      const found = Number.parseInt(String(declaredType).replace(/\D/g, ''), 10);
      if (found !== dimensions) {
        throw new StoreError(
          `la tabla ${CORPUS_TABLE} ya existe con ${declaredType}, pero el ` +
            `embedder "${corpus.embedder}" produce vectores de ${dimensions}. ` +
            'Indexar así falla en el INSERT. Usa otra base para este corpus, o ' +
            'reindexa desde cero con el embedder que corresponde a ese esquema.',
        );
      }
      return { prepared: true, alreadyExisted: true, dimensions };
    }

    for (const statement of schemaStatements(dimensions)) {
      try {
        await client.query(statement);
      } catch (err) {
        throw new StoreError(
          'no se pudo preparar el esquema: ' +
            `${err instanceof Error ? err.message : String(err)}. ` +
            '¿Tiene el usuario permisos de DDL? Si no, pide que ejecuten a ' +
            `mano:\n${statement.trim()}`,
          { cause: err },
        );
      }
    }
    return { prepared: true, alreadyExisted: false, dimensions };
  } finally {
    await client.end();
  }
};
