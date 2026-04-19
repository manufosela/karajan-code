// @ts-check

/**
 * @typedef {import('../domain/document.js').Document} Document
 * @typedef {import('../domain/document.js').Chunk} Chunk
 */

/**
 * Crea un Chunk heredando la metadata del Document origen.
 *
 * @param {Document} doc
 * @param {number} index
 * @param {string} content
 * @param {number} offset
 * @returns {Chunk}
 */
function makeChunk(doc, index, content, offset) {
  return {
    id: `${doc.id}#${index}`,
    documentId: doc.id,
    content,
    index,
    metadata: {
      ...doc.metadata,
      offset,
      tokens: Math.ceil(content.length / 4),
    },
  };
}

/**
 * Trocea un Document en chunks de tamaño fijo (por caracteres) con solapamiento.
 *
 * @param {Document} doc
 * @param {{ size: number, overlap?: number }} options
 * @returns {Chunk[]}
 */
export function chunkByFixedSize(doc, options) {
  const { size } = options;
  const overlap = options.overlap ?? 0;
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('chunkByFixedSize: "size" debe ser entero positivo.');
  }
  if (overlap < 0 || overlap >= size) {
    throw new Error('chunkByFixedSize: "overlap" debe estar en [0, size).');
  }
  const step = size - overlap;
  /** @type {Chunk[]} */
  const chunks = [];
  let offset = 0;
  let index = 0;
  const { content } = doc;
  if (content.length === 0) return chunks;
  while (offset < content.length) {
    const slice = content.slice(offset, offset + size);
    chunks.push(makeChunk(doc, index, slice, offset));
    index += 1;
    offset += step;
  }
  return chunks;
}

/**
 * Divide un texto por separadores jerárquicos y agrupa fragmentos hasta maxSize.
 * Si un fragmento individual supera maxSize, recurre al siguiente separador
 * y, en último extremo, lo corta en trozos fijos de tamaño maxSize.
 *
 * @param {string} content
 * @param {string[]} separators Lista ordenada de mayor a menor granularidad.
 * @param {number} maxSize
 * @returns {string[]}
 */
function splitRecursively(content, separators, maxSize) {
  if (content.length <= maxSize) return content.length === 0 ? [] : [content];
  if (separators.length === 0) {
    /** @type {string[]} */
    const parts = [];
    for (let i = 0; i < content.length; i += maxSize) {
      parts.push(content.slice(i, i + maxSize));
    }
    return parts;
  }
  const [sep, ...rest] = separators;
  const fragments = content.split(sep).filter((f) => f.length > 0);
  /** @type {string[]} */
  const pieces = [];
  for (const frag of fragments) {
    if (frag.length > maxSize) {
      pieces.push(...splitRecursively(frag, rest, maxSize));
    } else {
      pieces.push(frag);
    }
  }
  // Agrupar piezas consecutivas hasta llenar maxSize.
  /** @type {string[]} */
  const grouped = [];
  let buffer = '';
  for (const piece of pieces) {
    if ((buffer + sep + piece).length <= maxSize && buffer.length > 0) {
      buffer += sep + piece;
    } else if (buffer.length === 0) {
      buffer = piece;
    } else {
      grouped.push(buffer);
      buffer = piece;
    }
  }
  if (buffer.length > 0) grouped.push(buffer);
  return grouped;
}

/**
 * Chunker recursivo que respeta límites naturales.
 *
 * @param {Document} doc
 * @param {{ separators?: string[], maxSize: number }} options
 * @returns {Chunk[]}
 */
export function chunkBySeparators(doc, options) {
  const { maxSize } = options;
  const separators = options.separators ?? ['\n\n', '\n', '. ', ' '];
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new Error('chunkBySeparators: "maxSize" debe ser entero positivo.');
  }
  const pieces = splitRecursively(doc.content, separators, maxSize);
  let runningOffset = 0;
  const chunks = pieces.map((piece, index) => {
    const localOffset = doc.content.indexOf(piece, runningOffset);
    const offset = localOffset >= 0 ? localOffset : runningOffset;
    runningOffset = offset + piece.length;
    return makeChunk(doc, index, piece, offset);
  });
  return chunks;
}
