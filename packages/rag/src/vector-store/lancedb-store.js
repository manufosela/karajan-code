// @ts-check

/**
 * @typedef {import('./in-memory-vector-store.js').VectorRecord} VectorRecord
 * @typedef {import('./in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('./in-memory-vector-store.js').SearchOptions} SearchOptions
 */

/**
 * @typedef {Object} LanceDBStoreOptions
 * @property {string} [path] Directorio de la base LanceDB (default './data/lancedb').
 * @property {string} [table] Nombre de tabla (default 'karajan_rag_chunks').
 * @property {number} dimensions Dimensión del vector.
 * @property {any} [lancedb] Módulo @lancedb/lancedb inyectable (tests).
 */

/**
 * VectorStore persistente sobre LanceDB.
 *
 * `@lancedb/lancedb` se trata como **peer dependency opcional** — si no está
 * instalada, el constructor lanza con instrucción de instalación. Permite
 * inyectar el módulo en `opts.lancedb` para tests con mocks.
 *
 * Uso real:
 *   pnpm add @lancedb/lancedb
 *   const store = await LanceDBStore.open({ path: './data/lancedb', dimensions: 768 });
 *
 * Interfaz compatible con InMemoryVectorStore (upsert, search, size, delete).
 */
export class LanceDBStore {
  /**
   * @param {LanceDBStoreOptions} opts
   */
  constructor(opts) {
    if (!opts || !Number.isInteger(opts.dimensions) || opts.dimensions <= 0) {
      throw new Error('LanceDBStore: opts.dimensions debe ser entero positivo.');
    }
    this.path = opts.path ?? './data/lancedb';
    this.table = opts.table ?? 'karajan_rag_chunks';
    this.dimensions = opts.dimensions;
    this._lancedb = opts.lancedb ?? null;
    /** @type {any} */
    this._connection = null;
    /** @type {any} */
    this._tableRef = null;
  }

  /**
   * Factory estática que resuelve el módulo y devuelve un store listo.
   *
   * @param {LanceDBStoreOptions} opts
   * @returns {Promise<LanceDBStore>}
   */
  static async open(opts) {
    const store = new LanceDBStore(opts);
    await store._ensureTable();
    return store;
  }

  async _loadModule() {
    if (this._lancedb) return this._lancedb;
    try {
      const mod = await import('@lancedb/lancedb');
      this._lancedb = mod;
      return mod;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Cannot find package')) {
        throw new Error(
          "LanceDBStore requiere '@lancedb/lancedb'. Instala con: pnpm add @lancedb/lancedb",
          { cause: err },
        );
      }
      throw err;
    }
  }

  async _ensureTable() {
    if (this._tableRef) return this._tableRef;
    const lancedb = await this._loadModule();
    const connect = lancedb.connect ?? lancedb.default?.connect;
    if (typeof connect !== 'function') {
      throw new Error('LanceDBStore: el módulo no expone connect().');
    }
    this._connection = await connect(this.path);
    const names = await this._connection.tableNames();
    if (names.includes(this.table)) {
      this._tableRef = await this._connection.openTable(this.table);
    } else {
      // Placeholder schema — primer insert define el tipo real del vector.
      this._tableRef = await this._connection.createTable(this.table, [
        {
          id: '__bootstrap__',
          document_id: '',
          content: '',
          metadata: '{}',
          vector: new Array(this.dimensions).fill(0),
        },
      ]);
      await this._tableRef.delete(`id = '__bootstrap__'`);
    }
    return this._tableRef;
  }

  /**
   * @param {VectorRecord} record
   * @returns {Promise<void>}
   */
  async upsertOne(record) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error('upsertOne: record.id requerido.');
    }
    if (!Array.isArray(record.vector) || record.vector.length !== this.dimensions) {
      throw new Error(`upsertOne: record.vector dimensión ${this.dimensions}.`);
    }
    const table = await this._ensureTable();
    await table.delete(`id = '${escapeSql(record.id)}'`);
    await table.add([
      {
        id: record.id,
        document_id: String(record.metadata?.documentId ?? ''),
        content: String(record.metadata?.content ?? ''),
        metadata: JSON.stringify(record.metadata ?? {}),
        vector: record.vector,
      },
    ]);
  }

  /**
   * @param {VectorRecord[]} records
   */
  async upsert(records) {
    for (const r of records) {
       
      await this.upsertOne(r);
    }
  }

  async size() {
    const table = await this._ensureTable();
    return table.countRows ? table.countRows() : 0;
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const table = await this._ensureTable();
    const before = (await this.size()) || 0;
    await table.delete(`id = '${escapeSql(id)}'`);
    const after = (await this.size()) || 0;
    return after < before;
  }

  /**
   * Itera todos los records por lotes (para migración/export, 0.5.0).
   *
   * Nota: la API de LanceDB carga el resultado de `query().toArray()` en
   * memoria y se trocea aquí — suficiente para migración asistida v1;
   * el caso de volumen grande es Pg, que sí pagina en SQL.
   *
   * @param {{ batchSize?: number }} [options]
   * @returns {AsyncGenerator<VectorRecord[], void, void>}
   */
  async *scan(options = {}) {
    const batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new Error('scan: "batchSize" debe ser entero positivo.');
    }
    const table = await this._ensureTable();
    if (typeof table.query !== 'function') {
      throw new Error(
        'LanceDBStore.scan: la versión de @lancedb/lancedb no expone table.query(); actualízala para migrar.',
      );
    }
    const rows = await table.query().toArray();
    for (let i = 0; i < rows.length; i += batchSize) {
      yield rows.slice(i, i + batchSize).map((row) => ({
        id: String(row.id),
        vector: Array.from(row.vector ?? []),
        metadata:
          typeof row.metadata === 'string' ? safeParseJSON(row.metadata) : row.metadata ?? {},
      }));
    }
  }

  /**
   * Fingerprint del espacio vectorial (ADR-002, 0.5.0). Vive en un
   * fichero sidecar junto al directorio de datos de LanceDB — si copias
   * la tabla a otra ruta, copia también `.karajan-fingerprint`.
   *
   * @returns {Promise<string | null>}
   */
  async getIndexFingerprint() {
    const { readFile } = await import('node:fs/promises');
    try {
      const raw = await readFile(`${this.path}/.karajan-fingerprint`, 'utf8');
      return raw.trim() || null;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * @param {string} fingerprint
   * @returns {Promise<void>}
   */
  async setIndexFingerprint(fingerprint) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(this.path, { recursive: true });
    await writeFile(`${this.path}/.karajan-fingerprint`, `${fingerprint}\n`, 'utf8');
  }

  /**
   * Elimina todos los records de un documento (columna document_id,
   * poblada desde metadata.documentId al upsertear).
   *
   * Nota 0.5.0: tablas creadas con versiones anteriores no tienen la
   * columna — el predicado falla y se traduce a un error accionable.
   *
   * @param {string} documentId
   * @returns {Promise<number>} Records eliminados.
   */
  async deleteByDocument(documentId) {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new Error('deleteByDocument: "documentId" requerido (string no vacío).');
    }
    const table = await this._ensureTable();
    const before = (await this.size()) || 0;
    try {
      await table.delete(`document_id = '${escapeSql(documentId)}'`);
    } catch (err) {
      throw new Error(
        'LanceDBStore.deleteByDocument: la tabla no tiene columna document_id ' +
          '(creada antes de 0.5.0). Reindexa para regenerarla. ' +
          `Detalle: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const after = (await this.size()) || 0;
    return before - after;
  }

  /**
   * Busca top-K usando cosine similarity (LanceDB default).
   *
   * @param {number[]} queryVector
   * @param {SearchOptions} [options]
   * @returns {Promise<SearchHit[]>}
   */
  async search(queryVector, options = {}) {
    if (!Array.isArray(queryVector) || queryVector.length !== this.dimensions) {
      throw new Error(`search: queryVector dimensión ${this.dimensions}.`);
    }
    const topK = options.topK ?? 10;
    const table = await this._ensureTable();
    const searchResult = await table.search(queryVector).limit(topK * 4).toArray();
    const mapped = searchResult.map((row) => ({
      id: row.id,
      // LanceDB devuelve _distance (menor = más similar). Mapeamos a score = 1 - dist.
      score: typeof row._distance === 'number' ? 1 - row._distance : Number(row.score ?? 0),
      vector: Array.isArray(row.vector) ? row.vector : Array.from(row.vector ?? []),
      metadata:
        typeof row.metadata === 'string' ? safeParseJSON(row.metadata) : row.metadata ?? {},
    }));
    const filtered = options.filter ? mapped.filter((h) => options.filter(h.metadata)) : mapped;
    return filtered.slice(0, topK);
  }
}

/**
 * @param {string} input
 */
function escapeSql(input) {
  return String(input).replace(/'/g, "''");
}

/**
 * @param {string} s
 */
function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
