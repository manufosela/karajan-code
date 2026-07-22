// @ts-check

/**
 * @typedef {import('../domain/document.js').Document} Document
 * @typedef {import('../domain/document.js').Chunk} Chunk
 */

/**
 * Estimación de tokens a partir de caracteres. Heurística `length / 4` —
 * razonable para texto en inglés/español; imprecisa para código,
 * caracteres CJK o emojis. Documentada como aproximación en ADR-002
 * (implícito) y en README del módulo de chunking.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Crea un Chunk heredando la metadata del Document origen.
 *
 * @param {Document} doc
 * @param {number} index
 * @param {string} content
 * @param {number} offset
 * @returns {Chunk}
 */
function makeChunk(doc, index, content, offset, extraMeta = {}) {
  return {
    id: `${doc.id}#${index}`,
    documentId: doc.id,
    content,
    index,
    metadata: {
      ...doc.metadata,
      ...extraMeta,
      offset,
      tokens: estimateTokens(content),
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

/**
 * Trocea un Document por conteo aproximado de tokens.
 *
 * Importante: NO usa un tokenizer real (tiktoken/BPE) — aplica la
 * heurística `length / 4` de `estimateTokens`. Es suficiente para
 * calibrar chunks bajo límites de contexto del LLM sin introducir
 * dependencias pesadas, pero hay que asumir cierto error en
 * idiomas no latinos, código con símbolos, CJK y emojis.
 *
 * Internamente mapea maxTokens/overlapTokens a caracteres y delega
 * en `chunkByFixedSize`.
 *
 * @param {Document} doc
 * @param {{ maxTokens: number, overlapTokens?: number }} options
 * @returns {Chunk[]}
 */
export function chunkByTokens(doc, options) {
  const { maxTokens } = options;
  const overlapTokens = options.overlapTokens ?? 0;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('chunkByTokens: "maxTokens" debe ser entero positivo.');
  }
  if (!Number.isInteger(overlapTokens) || overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new Error('chunkByTokens: "overlapTokens" debe estar en [0, maxTokens).');
  }
  const size = maxTokens * 4;
  const overlap = overlapTokens * 4;
  return chunkByFixedSize(doc, { size, overlap });
}

/**
 * Trocea un Document Markdown respetando la jerarquía de headings.
 *
 * - Detecta líneas que empiezan por `#`, `##`, `###`… hasta el nivel máximo configurado.
 * - Asocia cada chunk al camino de headings vigente en ese punto
 *   (metadata.heading = "H1 > H2 > H3").
 * - Si una sección supera `maxSize` caracteres, se re-trocea con
 *   `chunkBySeparators` conservando la metadata.heading de la sección.
 *
 * @param {Document} doc
 * @param {{ levels?: number[], maxSize: number, separators?: string[] }} options
 * @returns {Chunk[]}
 */
export function chunkByHeadings(doc, options) {
  const { maxSize } = options;
  const levels = (options.levels ?? [1, 2, 3]).slice().sort((a, b) => a - b);
  const separators = options.separators ?? ['\n\n', '\n', '. ', ' '];
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new Error('chunkByHeadings: "maxSize" debe ser entero positivo.');
  }
  const maxLevel = levels[levels.length - 1];

  const lines = doc.content.split('\n');
  /** @type {Array<{ heading: string | null, lines: string[], startOffset: number }>} */
  const sections = [];
  /** @type {string[]} */
  const headingStack = new Array(maxLevel + 1).fill(null);
  /** @type {{ heading: string | null, lines: string[], startOffset: number } | null} */
  let current = null;
  let runningOffset = 0;

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (levels.includes(level)) {
        // Cierra sección previa.
        if (current) sections.push(current);
        headingStack[level] = text;
        for (let i = level + 1; i <= maxLevel; i += 1) headingStack[i] = null;
        const path = headingStack
          .slice(1, maxLevel + 1)
          .filter(Boolean)
          .join(' > ');
        current = { heading: path || text, lines: [line], startOffset: runningOffset };
      } else if (current) {
        current.lines.push(line);
      }
    } else if (current) {
      current.lines.push(line);
    } else {
      // Líneas antes del primer heading configurado.
      current = { heading: null, lines: [line], startOffset: runningOffset };
    }
    runningOffset += line.length + 1; // +1 por el \n dividido
  }
  if (current) sections.push(current);

  /** @type {Chunk[]} */
  const chunks = [];
  let idx = 0;
  for (const section of sections) {
    const content = section.lines.join('\n').trim();
    if (content.length === 0) continue;
    if (content.length <= maxSize) {
      chunks.push(makeChunk(doc, idx, content, section.startOffset, { heading: section.heading }));
      idx += 1;
    } else {
      const pieces = splitRecursively(content, separators, maxSize);
      for (const piece of pieces) {
        const localOffset = section.startOffset + content.indexOf(piece);
        chunks.push(
          makeChunk(
            doc,
            idx,
            piece,
            localOffset >= section.startOffset ? localOffset : section.startOffset,
            { heading: section.heading },
          ),
        );
        idx += 1;
      }
    }
  }
  return chunks;
}

const RECORD_FORMATS = Object.freeze(['csv', 'tsv', 'jsonl', 'auto']);

/**
 * Detecta el formato de un contenido tabular a partir de su primera línea:
 * objeto JSON → jsonl; tabulador → tsv; en otro caso → csv.
 *
 * @param {string} firstLine
 * @returns {'csv' | 'tsv' | 'jsonl'}
 */
function sniffRecordFormat(firstLine) {
  const trimmed = firstLine.trim();
  if (trimmed.startsWith('{')) return 'jsonl';
  if (trimmed.includes('\t')) return 'tsv';
  return 'csv';
}

/**
 * Trocea un Document tabular (CSV/TSV/JSONL) en lotes de registros.
 *
 * - CSV/TSV: la primera línea no vacía se trata como cabecera y se
 *   prependea a cada chunk para que los registros conserven su contexto
 *   de columnas al embeberse por separado.
 * - JSONL: cada línea es un registro autocontenido, sin cabecera.
 * - Las líneas vacías no cuentan como registro.
 * - `metadata.records` = nº de registros del chunk, `metadata.recordStart`
 *   = índice 1-based del primer registro, `metadata.format` = formato
 *   efectivo, `metadata.offset` = offset del primer registro del chunk.
 *
 * @param {Document} doc
 * @param {{ recordsPerChunk: number, format?: 'csv' | 'tsv' | 'jsonl' | 'auto' }} options
 * @returns {Chunk[]}
 */
export function chunkByRecords(doc, options) {
  const { recordsPerChunk } = options;
  const format = options.format ?? 'auto';
  if (!Number.isInteger(recordsPerChunk) || recordsPerChunk <= 0) {
    throw new Error('chunkByRecords: "recordsPerChunk" debe ser entero positivo.');
  }
  if (!RECORD_FORMATS.includes(format)) {
    throw new Error(`chunkByRecords: "format" debe ser uno de ${RECORD_FORMATS.join(', ')}.`);
  }

  const content = String(doc.content ?? '');
  /** @type {{ text: string, offset: number }[]} */
  const lines = [];
  let cursor = 0;
  for (const raw of content.split('\n')) {
    if (raw.trim().length > 0) lines.push({ text: raw, offset: cursor });
    cursor += raw.length + 1;
  }
  if (lines.length === 0) return [];

  const effectiveFormat = format === 'auto' ? sniffRecordFormat(lines[0].text) : format;
  const hasHeader = effectiveFormat !== 'jsonl';
  const header = hasHeader ? lines[0].text : null;
  const records = hasHeader ? lines.slice(1) : lines;

  const chunks = [];
  for (let start = 0; start < records.length; start += recordsPerChunk) {
    const batch = records.slice(start, start + recordsPerChunk);
    const body = batch.map((l) => l.text).join('\n');
    const text = header === null ? body : `${header}\n${body}`;
    chunks.push(
      makeChunk(doc, chunks.length, text, batch[0].offset, {
        format: effectiveFormat,
        records: batch.length,
        recordStart: start + 1,
      }),
    );
  }
  return chunks;
}
