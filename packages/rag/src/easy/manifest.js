// @ts-check
/**
 * Capa Easy RAG — manifest del índice local (ADR-005 §3).
 *
 * Implementa la política de reindex de ADR-002: un fingerprint a nivel
 * de índice (embedder|dimensions|opciones de chunking) más un hash de
 * contenido por fichero. Si el fingerprint cambia, el índice completo
 * queda inválido (nunca se mezclan espacios vectoriales); si solo
 * cambian ficheros, el diff permite reindexar de forma incremental.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST_DIR = '.karajan';
export const MANIFEST_FILE = 'manifest.json';

/**
 * @typedef {object} ManifestFileEntry
 * @property {string} hash Hash sha256 del contenido del fichero.
 * @property {'code' | 'docs' | 'data'} sourceType Preset aplicado.
 * @property {string[]} chunkIds Ids de los chunks upserteados en el store.
 * @property {import('../domain/document.js').Sensitivity} [sensitivity]
 *   Nivel estampado al indexar (KJR-BUG-0007): si el nivel resuelto por la
 *   config cambia, el fichero se reprocesa aunque su contenido no cambie.
 *   Ausente en manifests pre-0.8.0 → se reestampa en el siguiente index.
 *
 * @typedef {object} IndexManifest
 * @property {number} version
 * @property {string} fingerprint
 * @property {Record<string, ManifestFileEntry>} files Clave: ruta relativa al root indexado.
 */

/**
 * Fingerprint legible del espacio vectorial del índice. Dos índices con
 * fingerprints distintos son incompatibles entre sí.
 *
 * @param {{ embedderName: string, dimensions: number, chunkOptions?: Record<string, unknown> }} parts
 * @returns {string}
 */
export function computeIndexFingerprint(parts) {
  const { embedderName, dimensions } = parts;
  if (!embedderName || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('computeIndexFingerprint: embedderName y dimensions son obligatorios.');
  }
  const chunkPart = parts.chunkOptions ? JSON.stringify(parts.chunkOptions) : 'presets:default';
  const suffix = createHash('sha256').update(chunkPart).digest('hex').slice(0, 8);
  return `${embedderName}|${dimensions}|${suffix}`;
}

/**
 * @param {string} content
 * @returns {string} sha256 en hex.
 */
export function hashContent(content) {
  return createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
}

/**
 * @param {string} fingerprint
 * @returns {IndexManifest}
 */
export function createEmptyManifest(fingerprint) {
  return { version: 1, fingerprint, files: {} };
}

/**
 * Compara el manifest persistido con el estado actual del directorio.
 *
 * @param {IndexManifest} manifest
 * @param {Record<string, string>} currentHashes Ruta relativa → hash de contenido actual.
 * @returns {{ added: string[], changed: string[], removed: string[], unchanged: string[] }}
 */
export function diffManifest(manifest, currentHashes) {
  const known = manifest.files;
  const added = [];
  const changed = [];
  const unchanged = [];
  for (const [file, hash] of Object.entries(currentHashes)) {
    if (!(file in known)) added.push(file);
    else if (known[file].hash !== hash) changed.push(file);
    else unchanged.push(file);
  }
  const removed = Object.keys(known).filter((file) => !(file in currentHashes));
  return { added, changed, removed, unchanged };
}

/**
 * @param {string} rootDir Directorio indexado (el manifest vive en <root>/.karajan/).
 * @returns {string}
 */
function manifestPath(rootDir) {
  return path.join(rootDir, MANIFEST_DIR, MANIFEST_FILE);
}

/**
 * Valida la forma mínima de un manifest deserializado.
 *
 * @param {unknown} value
 * @returns {IndexManifest}
 */
function assertManifestShape(value) {
  const m = /** @type {IndexManifest} */ (value);
  const valid =
    m !== null &&
    typeof m === 'object' &&
    m.version === 1 &&
    typeof m.fingerprint === 'string' &&
    m.files !== null &&
    typeof m.files === 'object' &&
    !Array.isArray(m.files);
  if (!valid) {
    throw new Error(
      'loadManifest: manifest corrupto o de versión incompatible. Borra .karajan/ y reindexa.',
    );
  }
  return m;
}

/**
 * Carga el manifest del índice, o null si aún no existe.
 *
 * @param {string} rootDir
 * @returns {Promise<IndexManifest | null>}
 */
export async function loadManifest(rootDir) {
  let raw;
  try {
    raw = await readFile(manifestPath(rootDir), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('loadManifest: manifest ilegible (JSON inválido). Borra .karajan/ y reindexa.');
  }
  return assertManifestShape(parsed);
}

/**
 * Persiste el manifest en <root>/.karajan/manifest.json.
 *
 * @param {string} rootDir
 * @param {IndexManifest} manifest
 * @returns {Promise<void>}
 */
export async function saveManifest(rootDir, manifest) {
  await mkdir(path.join(rootDir, MANIFEST_DIR), { recursive: true });
  await writeFile(manifestPath(rootDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
