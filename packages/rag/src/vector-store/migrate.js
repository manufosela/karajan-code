// @ts-check
/**
 * Migración asistida entre vector stores (roadmap 0.5.0).
 *
 * Copia todos los records de un store a otro por lotes, sin re-embeber:
 * los vectores viajan tal cual, así que ambos stores deben compartir
 * espacio vectorial (misma dimensión; el fingerprint se propaga y
 * valida cuando ambos lo soportan). Idempotente: el destino se escribe
 * con upsert por id, relanzar una migración interrumpida es seguro.
 */
import { ensureIndexFingerprint } from './fingerprint-guard.js';

/**
 * @typedef {object} MigratableStore
 * @property {number} dimensions
 * @property {(options?: { batchSize?: number }) => AsyncGenerator<{ id: string, vector: number[], metadata?: Record<string, unknown> }[], void, void>} scan
 * @property {(records: { id: string, vector: number[], metadata?: Record<string, unknown> }[]) => void | Promise<void>} upsert
 * @property {() => string | null | Promise<string | null>} [getIndexFingerprint]
 * @property {(fingerprint: string) => void | Promise<void>} [setIndexFingerprint]
 *
 * @typedef {object} MigrationResult
 * @property {number} migrated Total de records copiados.
 * @property {number} batches Lotes procesados.
 * @property {string | null} fingerprint Fingerprint propagado, si lo había.
 */

/**
 * Migra todos los records de `source` a `target`.
 *
 * @param {MigratableStore} source
 * @param {MigratableStore} target
 * @param {{ batchSize?: number, onProgress?: (progress: { migrated: number, batches: number }) => void }} [options]
 * @returns {Promise<MigrationResult>}
 */
export async function migrateVectorStore(source, target, options = {}) {
  const batchSize = options.batchSize ?? 100;
  const onProgress = options.onProgress ?? (() => {});
  if (typeof source?.scan !== 'function') {
    throw new Error('migrateVectorStore: el store origen no expone scan().');
  }
  if (typeof target?.upsert !== 'function') {
    throw new Error('migrateVectorStore: el store destino no expone upsert().');
  }
  if (source.dimensions !== target.dimensions) {
    throw new Error(
      `migrateVectorStore: dimensiones incompatibles (origen ${source.dimensions}, ` +
        `destino ${target.dimensions}) — los vectores no se transforman; reindexa con el embedder destino.`,
    );
  }

  // El fingerprint viaja con los datos ANTES de escribir: un destino con
  // otro espacio registrado corta aquí (ensureIndexFingerprint lanza).
  /** @type {string | null} */
  let fingerprint = null;
  if (typeof source.getIndexFingerprint === 'function') {
    fingerprint = (await source.getIndexFingerprint()) ?? null;
  }
  if (
    fingerprint !== null &&
    typeof target.getIndexFingerprint === 'function' &&
    typeof target.setIndexFingerprint === 'function'
  ) {
    await ensureIndexFingerprint(/** @type {never} */ (target), fingerprint);
  }

  let migrated = 0;
  let batches = 0;
  for await (const batch of source.scan({ batchSize })) {
    await target.upsert(batch);
    migrated += batch.length;
    batches += 1;
    onProgress({ migrated, batches });
  }
  return { migrated, batches, fingerprint };
}
