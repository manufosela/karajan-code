// @ts-check
/**
 * Capa Easy RAG — detección de tipo de fuente y presets declarativos.
 *
 * Decisiones en ADR-005: la autodetección clasifica cada fichero como
 * código, docs o datos y le asigna un preset (chunker + defaults
 * deterministas de embedder/store). Los presets nunca tocan la policy de
 * sensibilidad ni la redacción PII, que siguen aplicándose aguas abajo
 * con los defaults del paquete.
 */
import path from 'node:path';
import {
  chunkBySeparators,
  chunkByHeadings,
  chunkByRecords,
} from '../ingestion/chunkers.js';

/**
 * @typedef {import('../domain/document.js').Document} Document
 * @typedef {import('../domain/document.js').Chunk} Chunk
 * @typedef {'code' | 'docs' | 'data'} PresetSourceType
 * @typedef {PresetSourceType | 'binary' | 'unknown'} SourceType
 *
 * @typedef {object} EasyPreset
 * @property {PresetSourceType} sourceType
 * @property {{ name: 'separators' | 'headings' | 'records', options: Record<string, unknown> }} chunker
 * @property {{ name: string }} embedder
 * @property {{ name: string }} store
 */

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.php', '.sh', '.bash', '.sql', '.astro',
  '.vue', '.svelte', '.css', '.scss', '.html',
]);

const DOCS_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.text', '.rst', '.adoc']);

const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.xml']);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.exe', '.dll', '.so',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.avi', '.mov',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.bin', '.wasm',
]);

/**
 * Clasifica un fichero por su extensión. Sin sniffing de contenido:
 * extensión desconocida (o ausente) → 'unknown', nunca una suposición
 * silenciosa.
 *
 * @param {string} filePath
 * @returns {SourceType}
 */
export function detectSourceType(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOCS_EXTENSIONS.has(ext)) return 'docs';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return 'unknown';
}

/**
 * Congela un objeto y sus valores anidados de primer y segundo nivel
 * (suficiente para la forma fija de un preset).
 *
 * @template T
 * @param {T} preset
 * @returns {T}
 */
function deepFreezePreset(preset) {
  for (const value of Object.values(/** @type {Record<string, unknown>} */ (preset))) {
    if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) {
        if (inner && typeof inner === 'object') Object.freeze(inner);
      }
      Object.freeze(value);
    }
  }
  return Object.freeze(preset);
}

/**
 * Separadores para código: priorizan límites de declaración antes de
 * caer a saltos de línea. Heurística sin AST (ver outOfScope de ADR-005).
 */
const CODE_SEPARATORS = Object.freeze([
  '\nclass ', '\nexport class ', '\nfunction ', '\nexport function ',
  '\nasync function ', '\nexport default ', '\nexport const ', '\nconst ',
  '\ndef ', '\nfunc ', '\n\n', '\n', ' ',
]);

/** @type {Record<PresetSourceType, EasyPreset>} */
const PRESETS = {
  code: deepFreezePreset({
    sourceType: 'code',
    chunker: { name: 'separators', options: { maxSize: 1600, separators: CODE_SEPARATORS } },
    embedder: { name: 'hash' },
    store: { name: 'lancedb' },
  }),
  docs: deepFreezePreset({
    sourceType: 'docs',
    chunker: { name: 'headings', options: { maxSize: 1200, levels: [1, 2, 3] } },
    embedder: { name: 'hash' },
    store: { name: 'lancedb' },
  }),
  data: deepFreezePreset({
    sourceType: 'data',
    chunker: { name: 'records', options: { recordsPerChunk: 50 } },
    embedder: { name: 'hash' },
    store: { name: 'lancedb' },
  }),
};

/**
 * Devuelve el preset inmutable para un tipo de fuente indexable.
 *
 * @param {PresetSourceType} sourceType
 * @returns {EasyPreset}
 */
export function resolvePreset(sourceType) {
  const preset = PRESETS[sourceType];
  if (!preset) {
    throw new Error(
      `resolvePreset: sourceType "${sourceType}" no es indexable (esperado: code, docs o data).`,
    );
  }
  return preset;
}

/**
 * Agrupa una lista de rutas por preset aplicable. Los ficheros binarios
 * o de extensión desconocida quedan en `excluded` con su razón, para que
 * el caller (index / manifest) los registre en vez de ignorarlos en
 * silencio.
 *
 * @param {string[]} filePaths
 * @returns {{ code: string[], docs: string[], data: string[], excluded: { path: string, reason: 'binary' | 'unknown' }[] }}
 */
export function classifySources(filePaths) {
  /** @type {{ code: string[], docs: string[], data: string[], excluded: { path: string, reason: 'binary' | 'unknown' }[] }} */
  const groups = { code: [], docs: [], data: [], excluded: [] };
  for (const filePath of filePaths) {
    const type = detectSourceType(filePath);
    if (type === 'binary' || type === 'unknown') {
      groups.excluded.push({ path: filePath, reason: type });
    } else {
      groups[type].push(filePath);
    }
  }
  return groups;
}

const CHUNKERS_BY_NAME = Object.freeze({
  separators: chunkBySeparators,
  headings: chunkByHeadings,
  records: chunkByRecords,
});

/**
 * Aplica el chunker declarado por un preset a un Document.
 *
 * @param {Document} doc
 * @param {EasyPreset} preset
 * @returns {Chunk[]}
 */
export function chunkWithPreset(doc, preset) {
  const chunker = CHUNKERS_BY_NAME[preset?.chunker?.name];
  if (!chunker) {
    throw new Error(
      `chunkWithPreset: chunker "${preset?.chunker?.name}" desconocido (esperado: ${Object.keys(CHUNKERS_BY_NAME).join(', ')}).`,
    );
  }
  return chunker(doc, /** @type {never} */ (preset.chunker.options));
}
