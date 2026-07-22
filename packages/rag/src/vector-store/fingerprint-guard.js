// @ts-check
/**
 * Guarda de fingerprint del espacio vectorial (roadmap 0.5.0 — completa
 * la política de reindex de ADR-002 más allá de la capa easy).
 *
 * El fingerprint (`embedder|dimensions|hash-de-chunking`) vive CON los
 * datos: campo en InMemory, tabla meta en Postgres, fichero sidecar en
 * LanceDB. Cualquier pipeline —declarativo o easy— que escriba en un
 * store con espacio incompatible falla explícitamente en vez de mezclar
 * embeddings inservibles en silencio.
 */

/**
 * @typedef {object} FingerprintAwareStore
 * @property {() => string | null | Promise<string | null>} getIndexFingerprint
 * @property {(fingerprint: string) => void | Promise<void>} setIndexFingerprint
 */

/**
 * Registra el fingerprint si el store no tiene ninguno, pasa si coincide
 * y lanza error accionable si difiere.
 *
 * @param {FingerprintAwareStore} store
 * @param {string} fingerprint
 * @returns {Promise<'registered' | 'ok'>}
 */
export async function ensureIndexFingerprint(store, fingerprint) {
  if (
    typeof store?.getIndexFingerprint !== 'function' ||
    typeof store?.setIndexFingerprint !== 'function'
  ) {
    throw new Error(
      'ensureIndexFingerprint: el store no expone getIndexFingerprint/setIndexFingerprint.',
    );
  }
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
    throw new Error('ensureIndexFingerprint: "fingerprint" requerido (string no vacío).');
  }
  const existing = await store.getIndexFingerprint();
  if (existing === null || existing === undefined) {
    await store.setIndexFingerprint(fingerprint);
    return 'registered';
  }
  if (existing === fingerprint) return 'ok';
  throw new Error(
    `ensureIndexFingerprint: el store contiene el espacio vectorial "${existing}" ` +
      `y se intenta escribir "${fingerprint}". Nunca se mezclan espacios (ADR-002): ` +
      'migra los datos (migrateVectorStore) o reindexa desde cero sobre un store vacío.',
  );
}
