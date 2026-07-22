// @ts-check
/**
 * Capa Easy RAG — indexado incremental de un directorio (ADR-005 §3-4).
 *
 * Orquesta: recorrido del directorio → clasificación por presets →
 * diff contra el manifest (ADR-002) → chunking + embedding + upsert de
 * añadidos/cambiados y delete de borrados → persistencia del manifest.
 *
 * El store y el embedder se inyectan: el caller (CLI) decide LanceDB,
 * pgvector o memoria, y este módulo queda testeable sin peer-deps.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { classifySources, resolvePreset, chunkWithPreset } from './presets.js';
import {
  computeIndexFingerprint,
  createEmptyManifest,
  diffManifest,
  hashContent,
  loadManifest,
  saveManifest,
  MANIFEST_DIR,
} from './manifest.js';
import { ensureIndexFingerprint } from '../vector-store/fingerprint-guard.js';

/**
 * @typedef {import('./manifest.js').IndexManifest} IndexManifest
 * @typedef {import('./presets.js').PresetSourceType} PresetSourceType
 *
 * @typedef {object} EasyEmbedder
 * @property {string} [name]
 * @property {number} dimensions
 * @property {(texts: string[]) => Promise<number[][]>} embedBatch
 *
 * @typedef {object} EasyVectorStore
 * @property {(records: { id: string, vector: number[], metadata?: Record<string, unknown> }[]) => void | Promise<void>} upsert
 * @property {(id: string) => unknown} delete
 * @property {() => number | Promise<number>} [size] Si existe, se usa como guarda de integridad manifest↔store.
 * @property {(documentId: string) => unknown} [deleteByDocument] Si existe, invalida documentos completos en una llamada.
 * @property {() => string | null | Promise<string | null>} [getIndexFingerprint] Guarda ADR-002 si existe junto a setIndexFingerprint.
 * @property {(fingerprint: string) => void | Promise<void>} [setIndexFingerprint]
 *
 * @typedef {object} IndexResult
 * @property {number} indexedFiles Ficheros añadidos o cambiados que se (re)procesaron.
 * @property {number} removedFiles Ficheros borrados cuyos chunks se invalidaron.
 * @property {number} unchangedFiles Ficheros saltados por hash idéntico.
 * @property {number} chunksUpserted
 * @property {boolean} fullReindex true si el fingerprint cambió y se reconstruyó todo.
 * @property {{ path: string, reason: 'binary' | 'unknown' }[]} excluded
 */

/** Directorios que nunca se indexan. */
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', MANIFEST_DIR, 'dist', 'build', 'coverage', '.next', '.astro',
]);

/**
 * Recorre el directorio y clasifica cada fichero por preset.
 *
 * @param {string} rootDir
 * @returns {Promise<{ groups: ReturnType<typeof classifySources>, relPaths: string[] }>}
 */
export async function collectIndexableFiles(rootDir) {
  let rootStat;
  try {
    rootStat = await stat(rootDir);
  } catch {
    throw new Error(`collectIndexableFiles: "${rootDir}" no existe o no es un directorio.`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`collectIndexableFiles: "${rootDir}" no es un directorio.`);
  }

  /** @type {string[]} */
  const relPaths = [];

  /** @param {string} current */
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
        continue;
      }
      if (entry.isFile() && !entry.name.startsWith('.')) {
        relPaths.push(path.relative(rootDir, full));
      }
    }
  }

  await walk(rootDir);
  relPaths.sort();
  return { groups: classifySources(relPaths), relPaths };
}

/**
 * Invalida en el store todos los chunks registrados para un fichero.
 *
 * @param {EasyVectorStore} store
 * @param {IndexManifest} manifest
 * @param {string} relPath
 */
async function deleteFileChunks(store, manifest, relPath) {
  // 0.5.0: los stores con deleteByDocument invalidan el documento entero
  // en una llamada; el resto cae al borrado chunk a chunk del manifest.
  if (typeof store.deleteByDocument === 'function') {
    await store.deleteByDocument(`doc:${relPath}`);
    return;
  }
  for (const chunkId of manifest.files[relPath]?.chunkIds ?? []) {
    await store.delete(chunkId);
  }
}

/**
 * Indexa (o reindexa incrementalmente) un directorio.
 *
 * @param {string} rootDir
 * @param {{ store: EasyVectorStore, embedder: EasyEmbedder, onEvent?: (msg: string) => void }} deps
 * @returns {Promise<IndexResult>}
 */
export async function indexDirectory(rootDir, deps) {
  const { store, embedder } = deps;
  const notify = deps.onEvent ?? (() => {});

  const { groups } = await collectIndexableFiles(rootDir);
  const fingerprint = computeIndexFingerprint({
    embedderName: embedder.name ?? 'hash',
    dimensions: embedder.dimensions,
  });

  let manifest = await loadManifest(rootDir);
  let fullReindex = false;
  if (manifest && Object.keys(manifest.files).length > 0 && typeof store.size === 'function') {
    // Guarda de integridad (KJR-BUG-0005): un manifest que declara ficheros
    // contra un store vacío (efímero o vaciado) produciría un "sin cambios"
    // silencioso con queries vacías. Se descarta el manifest y se reindexa.
    const storeSize = await store.size();
    if (storeSize === 0) {
      notify('manifest presente pero store vacío: reindex completo');
      manifest = null;
      fullReindex = true;
    }
  }
  if (manifest && manifest.fingerprint !== fingerprint) {
    // ADR-002: espacios vectoriales incompatibles — nunca se mezclan.
    notify(`fingerprint cambiado (${manifest.fingerprint} → ${fingerprint}): reindex completo`);
    for (const relPath of Object.keys(manifest.files)) {
      await deleteFileChunks(store, manifest, relPath);
    }
    manifest = null;
    fullReindex = true;
  }
  // ADR-002 generalizado (0.5.0): el fingerprint también vive en el store.
  // Tras un full-reindex se sobrescribe conscientemente; en el resto de
  // casos un espacio incompatible falla aquí, antes de tocar nada.
  if (
    typeof store.getIndexFingerprint === 'function' &&
    typeof store.setIndexFingerprint === 'function'
  ) {
    if (fullReindex) {
      await store.setIndexFingerprint(fingerprint);
    } else {
      await ensureIndexFingerprint(/** @type {never} */ (store), fingerprint);
    }
  }

  const previous = manifest ?? createEmptyManifest(fingerprint);

  /** @type {Record<string, { hash: string, content: string, sourceType: PresetSourceType }>} */
  const current = {};
  for (const sourceType of /** @type {PresetSourceType[]} */ (['code', 'docs', 'data'])) {
    for (const relPath of groups[sourceType]) {
      const content = await readFile(path.join(rootDir, relPath), 'utf8');
      current[relPath] = { hash: hashContent(content), content, sourceType };
    }
  }

  const diff = diffManifest(
    previous,
    Object.fromEntries(Object.entries(current).map(([p, v]) => [p, v.hash])),
  );

  const next = createEmptyManifest(fingerprint);
  for (const relPath of diff.unchanged) next.files[relPath] = previous.files[relPath];

  for (const relPath of diff.removed) {
    await deleteFileChunks(store, previous, relPath);
    notify(`invalidado: ${relPath}`);
  }

  let chunksUpserted = 0;
  for (const relPath of [...diff.added, ...diff.changed]) {
    if (diff.changed.includes(relPath)) await deleteFileChunks(store, previous, relPath);

    const { content, hash, sourceType } = current[relPath];
    const preset = resolvePreset(sourceType);
    const doc = {
      id: `doc:${relPath}`,
      content,
      metadata: { source: relPath, sourceType },
    };
    const chunks = chunkWithPreset(doc, preset);
    const vectors = await embedder.embedBatch(chunks.map((c) => c.content));
    await store.upsert(
      chunks.map((chunk, i) => ({
        id: chunk.id,
        vector: vectors[i],
        metadata: { ...chunk.metadata, content: chunk.content, documentId: chunk.documentId },
      })),
    );
    next.files[relPath] = { hash, sourceType, chunkIds: chunks.map((c) => c.id) };
    chunksUpserted += chunks.length;
    notify(`indexado: ${relPath} (${chunks.length} chunks)`);
  }

  await saveManifest(rootDir, next);

  return {
    indexedFiles: diff.added.length + diff.changed.length,
    removedFiles: diff.removed.length,
    unchangedFiles: diff.unchanged.length,
    chunksUpserted,
    fullReindex,
    excluded: groups.excluded,
  };
}
