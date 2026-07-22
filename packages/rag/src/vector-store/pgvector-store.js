// @ts-check

/**
 * @typedef {import('./in-memory-vector-store.js').VectorRecord} VectorRecord
 * @typedef {import('./in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('./in-memory-vector-store.js').SearchOptions} SearchOptions
 */

/**
 * @typedef {Object} PgClientLike
 * @property {(text: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }>} query
 * @property {() => Promise<void>} [end]
 */

/**
 * @typedef {Object} PgVectorStoreOptions
 * @property {string} [connectionString] Postgres connection string. Requerida si no se pasa "client".
 * @property {PgClientLike} [client] Cliente preconfigurado (util para tests con mocks).
 * @property {string} [table] Nombre de tabla. Default "karajan_rag_chunks".
 * @property {number} dimensions Dimensión del embedding.
 */

/**
 * Formatea un array numérico al literal pgvector ("[1.0,2.0,...]").
 *
 * @param {number[]} vector
 * @returns {string}
 */
function toPgVector(vector) {
  return `[${vector.join(',')}]`;
}

/**
 * VectorStore backend sobre pgvector.
 *
 * Schema esperado: `karajan_rag_chunks(id text, source text, chunk_index int,
 * content text, embedding vector(N), metadata jsonb, created_at timestamptz)`
 * creado por `migrations/001-init-pgvector.sql`.
 *
 * Interfaz idéntica al InMemoryVectorStore para ser intercambiable: upsert,
 * upsertOne, search, size, delete. Filtro por metadata soportado vía
 * SearchOptions.filter (aplicado en JS tras leer; en futuro se puede empujar
 * a SQL con jsonb_path_ops cuando el uso lo justifique).
 */
export class PgVectorStore {
  /**
   * @param {PgVectorStoreOptions} opts
   */
  constructor(opts) {
    if (!opts || !Number.isInteger(opts.dimensions) || opts.dimensions <= 0) {
      throw new Error('PgVectorStore: opts.dimensions debe ser entero positivo.');
    }
    if (!opts.client && !opts.connectionString) {
      throw new Error('PgVectorStore: se requiere "client" o "connectionString".');
    }
    this.dimensions = opts.dimensions;
    this.table = opts.table ?? 'karajan_rag_chunks';
    /** @type {PgClientLike | null} */
    this._client = opts.client ?? null;
    this._connectionString = opts.connectionString;
    /** @type {boolean} */
    this._ownsClient = false;
  }

  /**
   * Lazy-init del cliente si no se inyectó.
   *
   * @returns {Promise<PgClientLike>}
   */
  async _getClient() {
    if (this._client) return this._client;
    const { Client } = await import('pg');
    const client = new Client({ connectionString: this._connectionString });
    await client.connect();
    this._client = client;
    this._ownsClient = true;
    return client;
  }

  /**
   * Cierra la conexión si este store la creó.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this._client && this._ownsClient && typeof this._client.end === 'function') {
      await this._client.end();
      this._client = null;
    }
  }

  /**
   * @param {VectorRecord} record
   * @returns {Promise<void>}
   */
  async upsertOne(record) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error('upsertOne: record.id requerido (string no vacío).');
    }
    if (!Array.isArray(record.vector) || record.vector.length !== this.dimensions) {
      throw new Error(
        `upsertOne: record.vector debe tener dimensión ${this.dimensions}.`,
      );
    }
    const client = await this._getClient();
    const sql = `
      INSERT INTO ${this.table} (id, source, chunk_index, content, embedding, metadata)
      VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        source = EXCLUDED.source,
        chunk_index = EXCLUDED.chunk_index,
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata
    `;
    const meta = record.metadata ?? {};
    await client.query(sql, [
      record.id,
      /** @type {any} */ (meta).source ?? null,
      /** @type {any} */ (meta).chunk_index ?? /** @type {any} */ (meta).index ?? null,
      /** @type {any} */ (meta).content ?? null,
      toPgVector(record.vector),
      JSON.stringify(meta),
    ]);
  }

  /**
   * @param {VectorRecord[]} records
   * @returns {Promise<void>}
   */
  async upsert(records) {
    for (const r of records) {
       
      await this.upsertOne(r);
    }
  }

  /**
   * @returns {Promise<number>}
   */
  async size() {
    const client = await this._getClient();
    const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${this.table}`);
    return rows[0]?.c ?? 0;
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const client = await this._getClient();
    const res = await client.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Asegura la tabla meta compartida (clave/valor) del índice.
   *
   * @returns {Promise<PgClientLike>}
   */
  async _ensureMetaTable() {
    const client = await this._getClient();
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${this.table}_meta (key text PRIMARY KEY, value text NOT NULL)`,
    );
    return client;
  }

  /**
   * Fingerprint del espacio vectorial almacenado (ADR-002, 0.5.0).
   *
   * @returns {Promise<string | null>}
   */
  async getIndexFingerprint() {
    const client = await this._ensureMetaTable();
    const { rows } = await client.query(
      `SELECT value FROM ${this.table}_meta WHERE key = 'fingerprint'`,
    );
    return rows[0]?.value ?? null;
  }

  /**
   * @param {string} fingerprint
   * @returns {Promise<void>}
   */
  async setIndexFingerprint(fingerprint) {
    const client = await this._ensureMetaTable();
    await client.query(
      `INSERT INTO ${this.table}_meta (key, value) VALUES ('fingerprint', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [fingerprint],
    );
  }

  /**
   * Elimina todos los records de un documento (metadata->>'documentId').
   *
   * @param {string} documentId
   * @returns {Promise<number>} Records eliminados.
   */
  async deleteByDocument(documentId) {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new Error('deleteByDocument: "documentId" requerido (string no vacío).');
    }
    const client = await this._getClient();
    const res = await client.query(
      `DELETE FROM ${this.table} WHERE metadata->>'documentId' = $1`,
      [documentId],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Cosine similarity con el operador `<=>` (distancia coseno: menor = más similar).
   * Convertimos a score = 1 - distance para alinear con InMemoryVectorStore.
   *
   * @param {number[]} queryVector
   * @param {SearchOptions} [options]
   * @returns {Promise<SearchHit[]>}
   */
  async search(queryVector, options = {}) {
    if (!Array.isArray(queryVector) || queryVector.length !== this.dimensions) {
      throw new Error(`search: queryVector debe tener dimensión ${this.dimensions}.`);
    }
    const topK = options.topK ?? 10;
    const client = await this._getClient();
    const sql = `
      SELECT id, embedding, metadata,
             1 - (embedding <=> $1::vector) AS score
      FROM ${this.table}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const { rows } = await client.query(sql, [toPgVector(queryVector), topK * 4]);
    const mapped = rows.map((r) => ({
      id: r.id,
      score: Number(r.score),
      vector: typeof r.embedding === 'string' ? parsePgVector(r.embedding) : r.embedding,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
    }));
    const filtered = options.filter ? mapped.filter((h) => options.filter(h.metadata)) : mapped;
    return filtered.slice(0, topK);
  }
}

/**
 * Parsea un vector devuelto por pgvector en formato "[1.0,2.0,...]".
 *
 * @param {string} text
 * @returns {number[]}
 */
function parsePgVector(text) {
  if (typeof text !== 'string') return [];
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => !Number.isNaN(n));
}
