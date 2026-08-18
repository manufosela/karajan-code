// @ts-check
// Preparar el store es responsabilidad del producto (KJW-TSK-0022).
//
// Hasta ahora el esquema de pgvector solo existía dentro de scripts/smoke.sh:
// quien declaraba `store: pgvector` en su config se estrellaba, y la
// migración oficial del motor crea `vector(768)` mientras la capa Easy usa
// 256 (hash) o 384 (transformers) — seguirla al pie de la letra rompe el
// INSERT. Aquí se fija el comportamiento; el smoke lo prueba de verdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORPUS_TABLE,
  EMBEDDER_DIMENSIONS,
  StoreError,
  dimensionsFor,
  prepareStore,
} from '../src/store.js';

/**
 * Cliente `pg` de mentira que registra el SQL ejecutado.
 *
 * @param {{existingType?: string | null, failOn?: RegExp}} [options]
 */
const fakeClient = (options = {}) => {
  /** @type {string[]} */
  const executed = [];
  const client = {
    executed,
    connected: false,
    ended: false,
    async connect() {
      this.connected = true;
    },
    /** @param {string} sql */
    async query(sql) {
      executed.push(sql);
      if (options.failOn?.test(sql)) throw new Error('permiso denegado');
      if (/format_type/.test(sql)) {
        return options.existingType === undefined || options.existingType === null
          ? { rows: [] }
          : { rows: [{ type: options.existingType }] };
      }
      return { rows: [] };
    },
    async end() {
      this.ended = true;
    },
  };
  return client;
};

const pgCorpus = (embedder = 'hash') => ({
  store: 'pgvector',
  embedder,
  sensitivity: 'internal',
});

test('cada embedder tiene su dimensión, y una desconocida falla', () => {
  assert.equal(dimensionsFor('hash'), 256);
  assert.equal(dimensionsFor('transformers'), 384);
  assert.equal(EMBEDDER_DIMENSIONS.hash, 256);
  assert.throws(() => dimensionsFor('inventado'), StoreError);
});

test('store vacío: crea extensión, tabla e índices con la dimensión del embedder', async () => {
  const client = fakeClient();
  const result = await prepareStore({
    corpus: pgCorpus('hash'),
    connectionString: 'postgres://x/y',
    deps: { createClient: () => client },
  });

  const sql = client.executed.join('\n');
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${CORPUS_TABLE}`, 'i'));
  assert.match(sql, /vector\(256\)/, 'la dimensión sale del embedder, no de un valor fijo');
  assert.doesNotMatch(sql, /vector\(768\)/, 'el 768 de la migración del motor rompería el INSERT');
  assert.match(sql, /hnsw/i);
  assert.equal(result.prepared, true);
  assert.equal(result.dimensions, 256);
  assert.equal(client.ended, true, 'la conexión se cierra siempre');
});

test('transformers usa 384, no el default de hash', async () => {
  const client = fakeClient();
  await prepareStore({
    corpus: pgCorpus('transformers'),
    connectionString: 'postgres://x/y',
    deps: { createClient: () => client },
  });
  assert.match(client.executed.join('\n'), /vector\(384\)/);
});

test('store ya preparado con la misma dimensión: idempotente, no destruye nada', async () => {
  const client = fakeClient({ existingType: 'vector(256)' });
  const result = await prepareStore({
    corpus: pgCorpus('hash'),
    connectionString: 'postgres://x/y',
    deps: { createClient: () => client },
  });

  const sql = client.executed.join('\n');
  assert.doesNotMatch(sql, /DROP TABLE/i, 'jamás se borra un corpus existente');
  assert.equal(result.prepared, true);
  assert.equal(result.alreadyExisted, true);
});

test('dimensión distinta a la del embedder: falla en rojo citando ambas', async () => {
  const client = fakeClient({ existingType: 'vector(768)' });
  await assert.rejects(
    () =>
      prepareStore({
        corpus: pgCorpus('hash'),
        connectionString: 'postgres://x/y',
        deps: { createClient: () => client },
      }),
    (err) =>
      err instanceof StoreError &&
      err.message.includes('768') &&
      err.message.includes('256'),
    'el mensaje debe decir qué hay y qué se esperaba, o no sirve de nada',
  );
});

test('sin permisos para el DDL: dice qué SQL ejecutar a mano', async () => {
  const client = fakeClient({ failOn: /CREATE EXTENSION/i });
  await assert.rejects(
    () =>
      prepareStore({
        corpus: pgCorpus('hash'),
        connectionString: 'postgres://x/y',
        deps: { createClient: () => client },
      }),
    (err) => err instanceof StoreError && /CREATE EXTENSION/i.test(err.message),
  );
});

test('store que no necesita preparación: no-op explícito, nunca silencio', async () => {
  for (const store of ['lancedb', 'in-memory']) {
    const result = await prepareStore({
      corpus: { store, embedder: 'hash', sensitivity: 'internal' },
      connectionString: undefined,
      deps: {
        createClient: () => {
          throw new Error('no debería conectar con un store de fichero');
        },
      },
    });
    assert.equal(result.prepared, false, store);
    assert.match(result.reason, /lancedb|memoria|fichero/i, store);
  }
});

test('pgvector sin cadena de conexión: error antes de intentar nada', async () => {
  await assert.rejects(
    () => prepareStore({ corpus: pgCorpus('hash'), connectionString: '' }),
    (err) => err instanceof StoreError && /PG_URL|conexión/i.test(err.message),
  );
});

test('sin el paquete pg: dice cuál instalar, no un ERR_MODULE_NOT_FOUND', async () => {
  // Sin inyectar cliente, para ejercitar la resolución real: en este repo
  // `pg` es un peer opcional que NO está instalado, así que se recorre el
  // camino de error completo.
  await assert.rejects(
    () => prepareStore({ corpus: pgCorpus('hash'), connectionString: 'postgres://x/y' }),
    (err) => err instanceof StoreError && /install pg/.test(err.message),
    'un ERR_MODULE_NOT_FOUND crudo no le dice nada a quien despliega',
  );
});
