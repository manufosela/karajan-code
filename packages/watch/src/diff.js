// @ts-check
/**
 * F2 — parseo del diff mergeado a chunks-query.
 *
 * Convierte un git unified diff en chunks (uno por hunk) con metadatos:
 * repo origen, path nuevo/viejo, tipo de cambio y líneas añadidas y
 * quitadas numeradas. Es la unidad de consulta del pipeline de impacto:
 * el retrieval (KJW-TSK-0005) usa `text` como query contra el corpus.
 *
 * Sin dependencias y sin fallbacks silenciosos: un diff vacío o que no
 * matchea el formato de git lanza {@link DiffError}.
 */

/** Error de parseo de diff: entrada vacía o formato no reconocido. */
export class DiffError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'DiffError';
  }
}

/**
 * @typedef {Object} DiffLine
 * @property {number} line Número de línea (en el fichero nuevo para añadidas, en el viejo para quitadas).
 * @property {string} content Contenido de la línea sin el prefijo +/-.
 *
 * @typedef {'added' | 'modified' | 'deleted' | 'renamed' | 'binary'} ChangeType
 *
 * @typedef {Object} DiffChunk
 * @property {string} repo Repo origen del merge.
 * @property {string} path Path nuevo del fichero (namespace del corpus: `repo/path`).
 * @property {string | null} oldPath Path anterior (renames) o null si el fichero es nuevo.
 * @property {ChangeType} changeType
 * @property {number} newStart Primera línea del hunk en el fichero nuevo (0 para borrados/binarios).
 * @property {DiffLine[]} addedLines
 * @property {DiffLine[]} removedLines
 * @property {string} text Contenido cambiado (añadido + quitado) como texto de consulta.
 */

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Estado del fichero en curso durante el parseo.
 *
 * @typedef {Object} FileState
 * @property {string} newPath
 * @property {string} oldPath
 * @property {boolean} isNew
 * @property {boolean} isDeleted
 * @property {boolean} isRenamed
 * @property {boolean} isBinary
 * @property {DiffChunk[]} chunks
 */

/**
 * @param {FileState} file
 * @returns {ChangeType}
 */
const changeTypeOf = (file) => {
  if (file.isBinary) return 'binary';
  if (file.isNew) return 'added';
  if (file.isDeleted) return 'deleted';
  if (file.isRenamed) return 'renamed';
  return 'modified';
};

/**
 * @param {FileState} file
 * @param {string} repoName
 * @returns {DiffChunk[]}
 */
const finishFile = (file, repoName) => {
  // Un fichero binario (o un rename puro sin hunks) también es un cambio:
  // se emite un chunk sin líneas para que el pipeline lo vea pasar.
  if (file.chunks.length === 0) {
    return [
      {
        repo: repoName,
        path: file.newPath,
        oldPath: file.isNew ? null : file.oldPath,
        changeType: changeTypeOf(file),
        newStart: 0,
        addedLines: [],
        removedLines: [],
        text: '',
      },
    ];
  }
  return file.chunks;
};

/**
 * Parsea un git unified diff a chunks-query.
 *
 * @param {string} diffText
 * @param {{repoName: string}} [options]
 * @returns {DiffChunk[]}
 */
export const parseUnifiedDiff = (diffText, options) => {
  const repoName = options?.repoName;
  if (typeof repoName !== 'string' || repoName.length === 0) {
    throw new DiffError('repoName requerido: string no vacío con el repo origen del diff.');
  }
  if (typeof diffText !== 'string' || diffText.trim().length === 0) {
    throw new DiffError('diff vacío: no hay nada que parsear.');
  }

  /** @type {DiffChunk[]} */
  const result = [];
  /** @type {FileState | null} */
  let file = null;
  /** @type {DiffChunk | null} */
  let hunk = null;
  let newLine = 0;
  let oldLine = 0;

  for (const rawLine of diffText.split('\n')) {
    const headerMatch = FILE_HEADER.exec(rawLine);
    if (headerMatch) {
      if (file) result.push(...finishFile(file, repoName));
      file = {
        oldPath: headerMatch[1],
        newPath: headerMatch[2],
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        isBinary: false,
        chunks: [],
      };
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (rawLine.startsWith('new file mode')) {
      file.isNew = true;
    } else if (rawLine.startsWith('deleted file mode')) {
      file.isDeleted = true;
    } else if (rawLine.startsWith('rename from ')) {
      file.isRenamed = true;
      file.oldPath = rawLine.slice('rename from '.length);
    } else if (rawLine.startsWith('rename to ')) {
      file.newPath = rawLine.slice('rename to '.length);
    } else if (rawLine.startsWith('Binary files ') || rawLine.startsWith('GIT binary patch')) {
      file.isBinary = true;
    } else {
      const hunkMatch = HUNK_HEADER.exec(rawLine);
      if (hunkMatch) {
        oldLine = Number.parseInt(hunkMatch[1], 10);
        newLine = Number.parseInt(hunkMatch[2], 10);
        hunk = {
          repo: repoName,
          path: file.newPath,
          oldPath: file.isNew ? null : file.oldPath,
          changeType: changeTypeOf(file),
          newStart: newLine,
          addedLines: [],
          removedLines: [],
          text: '',
        };
        file.chunks.push(hunk);
      } else if (hunk) {
        if (rawLine.startsWith('+')) {
          hunk.addedLines.push({ line: newLine, content: rawLine.slice(1) });
          newLine += 1;
        } else if (rawLine.startsWith('-')) {
          hunk.removedLines.push({ line: oldLine, content: rawLine.slice(1) });
          oldLine += 1;
        } else if (rawLine.startsWith(' ')) {
          newLine += 1;
          oldLine += 1;
        }
        // Otras líneas (\ No newline at end of file, index…) no afectan a la numeración.
      }
    }
  }
  if (file) result.push(...finishFile(file, repoName));

  if (result.length === 0) {
    throw new DiffError('el texto no contiene ningún fichero de git unified diff.');
  }

  return result.map((chunk) => ({
    ...chunk,
    text: [...chunk.addedLines, ...chunk.removedLines].map((l) => l.content).join('\n'),
  }));
};
