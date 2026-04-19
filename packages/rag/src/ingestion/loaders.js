// @ts-check
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {import('../domain/document.js').Document} Document
 */

const MIME_BY_EXT = Object.freeze({
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain',
});

/**
 * Detecta el mimeType razonable a partir de la extensión.
 *
 * @param {string} filePath
 * @returns {string}
 */
function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Construye un ID estable para un documento a partir de su ruta.
 *
 * @param {string} filePath
 * @returns {string}
 */
function idFromPath(filePath) {
  return `doc:${path.resolve(filePath)}`;
}

/**
 * Carga un fichero de texto/markdown como Document.
 *
 * @param {string} filePath Ruta absoluta o relativa.
 * @returns {Promise<Document>}
 */
export async function loadTextFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  return {
    id: idFromPath(filePath),
    content,
    metadata: {
      source: path.resolve(filePath),
      mimeType: detectMimeType(filePath),
      isoDate: new Date().toISOString(),
    },
  };
}

/**
 * Carga todos los ficheros .md/.txt de un directorio (no recursivo por defecto).
 *
 * @param {string} dirPath
 * @param {{ recursive?: boolean, extensions?: string[] }} [options]
 * @returns {Promise<Document[]>}
 */
export async function loadTextDirectory(dirPath, options = {}) {
  const recursive = options.recursive ?? false;
  const extensions = (options.extensions ?? ['.md', '.markdown', '.txt', '.text']).map((e) =>
    e.toLowerCase(),
  );
  /** @type {string[]} */
  const candidates = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) candidates.push(full);
    }
  }

  const stats = await stat(dirPath);
  if (!stats.isDirectory()) {
    throw new Error(`loadTextDirectory: "${dirPath}" no es un directorio.`);
  }
  await walk(dirPath);

  const documents = await Promise.all(candidates.map((p) => loadTextFile(p)));
  return documents;
}
